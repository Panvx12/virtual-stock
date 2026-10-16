const CHART_SCRIPT_URL = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';

const SUPABASE_URL = 'https://jofmnltiasuvzozauwor.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_BLVholCvkP5hFi7lWLTVww_FHLu2JlF';

const MAX_HISTORY_LIMIT = 300; // 約 5 個交易日的 5 分鐘 K 線
const UPDATE_FREQUENCY = 60000; // 每 60 秒查詢一次外部行情；不會每次寫入 Supabase
const CANDLE_BATCH_SIZE = 5; // 累積 5 根已完成 K 線後才批次儲存

let marketPollTimer = null;
let isPollingMarket = false;
let appInitialized = false;
let marketDataAvailable = false;
let lastRenderedTime = null;
let completedCandleTimes = new Set();
let pendingCompletedCandles = [];

let supabaseClient = null;
let chart = null;
let candlestickSeries = null;

let activeClose = 10.0;
let activeOpen = 10.0;
let activeHigh = 10.0;
let activeLow = 10.0;
let activeCandleTime = Math.floor(Date.now() / 1000);
let candleList = [];
let holidayMap = {}; 

let currentUser = null;
let userWallet = { cash: 100000, shares: 0, username: '' };

function loadScript(url) {
    return new Promise((resolve, reject) => {
        if (window.LightweightCharts) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
        document.head.appendChild(script);
    });
}

async function initApp() {
    if (appInitialized) return;
    appInitialized = true;

    try {
        await loadScript(CHART_SCRIPT_URL);
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = supabaseClient;

        setupAuthListeners();
        setupTradingListeners();
        await checkUserSession();

        const chartContainer = document.getElementById('chart-container');
        if (!chartContainer) throw new Error('Missing #chart-container');

        chart = LightweightCharts.createChart(chartContainer, {
            width: chartContainer.clientWidth,
            height: 300,
            layout: {
                background: { type: 'solid', color: '#1f2937' },
                textColor: '#9ca3af',
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: '#374151' },
                horzLines: { color: '#374151' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                fixLeftEdge: false,
                rightOffset: 3,
                rightBarStaysOnScroll: true,
            },
        });

        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#ef4444',
            downColor: '#22c55e',
            borderUpColor: '#ef4444',
            borderDownColor: '#22c55e',
            wickUpColor: '#ef4444',
            wickDownColor: '#22c55e',
            wickVisible: true,
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });

        await loadStockData();
        updateMarketStatusText();

        if (marketPollTimer) clearInterval(marketPollTimer);
        marketPollTimer = setInterval(refreshMarketData, UPDATE_FREQUENCY);

        window.addEventListener('resize', () => {
            if (chart && chartContainer.isConnected) {
                chart.resize(chartContainer.clientWidth, 300);
            }
        });
    } catch (error) {
        console.error('Application initialization failed:', error);
        const statusEl = document.getElementById('index-status');
        if (statusEl) statusEl.innerText = '初始化失敗；請檢查網路及行情 API 設定。';
    }
}

async function checkUserSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        currentUser = session.user;
        await loadUserWallet(currentUser.id);
    } else {
        currentUser = null;
        userWallet = { cash: 100000, shares: 0, username: '' };
    }
    updateAuthUI(session);
}

async function loadUserWallet(userId) {
    const { data, error } = await supabaseClient
        .from('user_data')
        .select('*')
        .eq('user_id', userId)
        .single();

    const metadataUsername = currentUser.user_metadata?.username;
    const defaultUsername = metadataUsername || currentUser.email.split('@')[0];

    if (error || !data) {
        const initialWallet = { user_id: userId, username: defaultUsername, cash: 100000, shares: 0 };
        const { error: insertError } = await supabaseClient
            .from('user_data')
            .insert([initialWallet]);
        
        if (!insertError) {
            userWallet = { cash: 100000, shares: 0, username: defaultUsername };
        }
    } else {
        let currentUsername = data.username || defaultUsername;
        if (!data.username) {
            await supabaseClient
                .from('user_data')
                .update({ username: currentUsername })
                .eq('user_id', userId);
        }
        userWallet = { cash: data.cash, shares: data.shares, username: currentUsername };
    }
    updateWalletUI();
    updateAuthUI({ user: currentUser });
}

function updateWalletUI() {
    const cashEl = document.getElementById('user-cash');
    const sharesEl = document.getElementById('user-shares');
    if (cashEl && sharesEl) {
        cashEl.innerText = userWallet.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        sharesEl.innerText = userWallet.shares.toLocaleString();
    }
}

function updateAuthUI(session) {
    const userInfo = document.getElementById('user-info');
    const authActionBtn = document.getElementById('auth-action-btn');
    const tradingPanel = document.getElementById('trading-panel');
    const btnNewArticle = document.getElementById('btn-new-article');

    if (!userInfo || !authActionBtn) return;

    if (session && session.user) {
        userInfo.style.display = 'inline';
        const displayName = userWallet.username || session.user.user_metadata?.username || session.user.email.split('@')[0];
        userInfo.innerText = `👤 ${displayName}`;
        authActionBtn.innerText = 'Logout';
        if (tradingPanel) tradingPanel.style.display = 'flex';
        if (btnNewArticle) btnNewArticle.style.display = 'inline-block';
    } else {
        userInfo.style.display = 'none';
        userInfo.innerText = '';
        authActionBtn.innerText = 'Login';
        if (tradingPanel) tradingPanel.style.display = 'none';
        if (btnNewArticle) btnNewArticle.style.display = 'none';
    }
}

function setupTradingListeners() {
    const btnBuy = document.getElementById('btn-buy');
    const btnSell = document.getElementById('btn-sell');

    if (btnBuy) {
        btnBuy.addEventListener('click', async () => {
            if (!marketDataAvailable) {
                alert('Market data is unavailable. Trading is temporarily disabled.');
                return;
            }
            if (!currentUser) {
                alert('Please login first.');
                return;
            }
            const qty = parseInt(document.getElementById('trade-qty').value);
            if (isNaN(qty) || qty <= 0) {
                alert('Please enter a valid quantity.');
                return;
            }

            const totalCost = qty * activeClose;
            if (userWallet.cash < totalCost) {
                alert('Insufficient cash balance!');
                return;
            }

            userWallet.cash -= totalCost;
            userWallet.shares += qty;

            await saveUserWallet();
            updateWalletUI();
            alert(`Successfully bought ${qty} shares for ${totalCost.toFixed(2)} TWD.`);
        });
    }

    if (btnSell) {
        btnSell.addEventListener('click', async () => {
            if (!marketDataAvailable) {
                alert('Market data is unavailable. Trading is temporarily disabled.');
                return;
            }
            if (!currentUser) {
                alert('Please login first.');
                return;
            }
            const qty = parseInt(document.getElementById('trade-qty').value);
            if (isNaN(qty) || qty <= 0) {
                alert('Please enter a valid quantity.');
                return;
            }

            if (userWallet.shares < qty) {
                alert('Insufficient shares to sell!');
                return;
            }

            const totalRevenue = qty * activeClose;
            userWallet.cash += totalRevenue;
            userWallet.shares -= qty;

            await saveUserWallet();
            updateWalletUI();
            alert(`Successfully sold ${qty} shares for ${totalRevenue.toFixed(2)} TWD.`);
        });
    }
}

async function saveUserWallet() {
    if (!currentUser) return;
    await supabaseClient
        .from('user_data')
        .update({ cash: userWallet.cash, shares: userWallet.shares, username: userWallet.username })
        .eq('user_id', currentUser.id);
}

function setupAuthListeners() {
    const authActionBtn = document.getElementById('auth-action-btn');
    const authModal = document.getElementById('auth-modal');
    const closeModal = document.getElementById('close-modal');
    const authForm = document.getElementById('auth-form');
    const btnSignup = document.getElementById('btn-signup');
    const authMessage = document.getElementById('auth-message');

    if (!authActionBtn || !authModal) return;

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        // checkUserSession() handles the initial session, so do not load the wallet twice.
        if (event === 'INITIAL_SESSION') return;

        if (session && session.user) {
            const userChanged = !currentUser || currentUser.id !== session.user.id;
            currentUser = session.user;
            if (userChanged) {
                await loadUserWallet(currentUser.id);
            } else {
                updateAuthUI({ user: currentUser });
            }
        } else if (currentUser) {
            currentUser = null;
            userWallet = { cash: 100000, shares: 0, username: '' };
            updateWalletUI();
            updateAuthUI(null);
        }
    });

    authActionBtn.addEventListener('click', async () => {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            await supabaseClient.auth.signOut();
            alert('Successfully logged out.');
        } else {
            authModal.style.display = 'flex';
            authMessage.innerText = '';
        }
    });

    if (closeModal) {
        closeModal.addEventListener('click', () => { authModal.style.display = 'none'; });
    }
    window.addEventListener('click', (e) => {
        if (e.target === authModal) { authModal.style.display = 'none'; };
    });

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            
            authMessage.innerText = 'Processing...';
            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
            
            if (error) {
                authMessage.innerText = 'Login failed: ' + error.message;
            } else {
                authModal.style.display = 'none';
                authMessage.innerText = '';
            }
        });
    }

    if (btnSignup) {
        btnSignup.addEventListener('click', async () => {
            const usernameInput = document.getElementById('auth-username').value.trim();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            
            if (!email || !password) {
                authMessage.innerText = 'Please enter email and password.';
                return;
            }

            authMessage.innerText = 'Signing up...';
            const { error } = await supabaseClient.auth.signUp({ 
                email, 
                password,
                options: {
                    data: {
                        username: usernameInput || email.split('@')[0]
                    }
                }
            });
            
            if (error) {
                authMessage.innerText = 'Sign up failed: ' + error.message;
            } else {
                alert('Sign up successful! Please log in.');
                authModal.style.display = 'none';
                authMessage.innerText = '';
            }
        });
    }
}

async function fetchTaiwanIndexTrend() {
    try {
        // 目標 Yahoo 股市網址（例如 Yahoo Finance 的台股加權指數 ^TWII JSON API 或頁面）
        // 這裡以 Yahoo Finance API 為例
        const targetUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1m';
        
        // 使用 AllOrigins 代理抓取
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        
        // 解析 Yahoo Finance API 回傳的資料結構
        const result = data.chart.result[0];
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice;
        const previousClose = meta.chartPreviousClose || meta.previousClose;
        
        // 計算漲跌幅百分比
        const percentChange = ((currentPrice - previousClose) / previousClose) * 100;

        // 同步更新全域變數，讓畫面的 activeClose 跟著 Yahoo 即時資料走
        activeClose = currentPrice;

        return { 
            percentChange: percentChange, 
            totalDayPercent: percentChange 
        };
    } catch (error) {
        console.error('Failed to fetch Yahoo data via AllOrigins:', error);
        return null;
    }
}

async function loadStockData() {
    let bars = [];
    try {
        bars = await fetchMarketBars();
        const sourceLabel = 'Yahoo Finance · 5 分鐘（可能延遲）';
        const statusEl = document.getElementById('index-status');
        if (statusEl) {
            statusEl.innerText = sourceLabel;
            statusEl.style.color = '#9ca3af';
        }
    } catch (apiError) {
        console.warn('外部行情暫時不可用，嘗試讀取既有 Supabase 快取：', apiError);
        const { data, error } = await supabaseClient
            .from('stock_data')
            .select('history')
            .eq('id', 1)
            .maybeSingle();

        if (!error && data && Array.isArray(data.history)) {
            bars = data.history
                .filter((bar) => bar && Number.isFinite(bar.time) &&
                    Number.isFinite(bar.open) && Number.isFinite(bar.high) &&
                    Number.isFinite(bar.low) && Number.isFinite(bar.close))
                .slice(-MAX_HISTORY_LIMIT);
        }

        const statusEl = document.getElementById('index-status');
        if (statusEl) {
            statusEl.innerText = bars.length
                ? '⚠ 外部行情暫時不可用；顯示 Supabase 快取（非即時）'
                : '⚠ 行情 API 無法使用，且沒有可用快取';
            statusEl.style.color = '#f59e0b';
        }
    }

    candleList = bars;
    marketDataAvailable = bars.length > 0;
    completedCandleTimes = new Set(
        bars.slice(0, Math.max(0, bars.length - 1)).map((bar) => bar.time)
    );
    pendingCompletedCandles = [];
    lastRenderedTime = bars.length ? bars[bars.length - 1].time : null;

    if (bars.length) {
        candlestickSeries.setData(bars);
        chart.timeScale().scrollToRealTime();

        const last = bars[bars.length - 1];
        activeClose = last.close;
        activeOpen = last.open;
        activeHigh = last.high;
        activeLow = last.low;
        activeCandleTime = last.time;
        renderPriceSummary(last);
    } else {
        candlestickSeries.setData([]);
    }
}

async function refreshMarketData() {
    if (isPollingMarket || !supabaseClient || !candlestickSeries) return;
    isPollingMarket = true;

    try {
        const bars = await fetchMarketBars();
        if (!bars.length) return;
        marketDataAvailable = true;

        // Incremental update only: update the previous current candle and any new bars.
        const previousLatestTime = lastRenderedTime;
        for (const bar of bars) {
            if (lastRenderedTime === null || bar.time >= lastRenderedTime) {
                candlestickSeries.update(bar);
                lastRenderedTime = bar.time;
            }
        }
        if (previousLatestTime !== null && lastRenderedTime > previousLatestTime) {
            chart.timeScale().scrollToRealTime();
        }

        candleList = bars;
        const latest = bars[bars.length - 1];
        activeClose = latest.close;
        activeOpen = latest.open;
        activeHigh = latest.high;
        activeLow = latest.low;
        activeCandleTime = latest.time;
        renderPriceSummary(latest);

        // Bound the completion tracker to the current 5-day window.
        const currentTimes = new Set(bars.map((bar) => bar.time));
        completedCandleTimes = new Set(
            [...completedCandleTimes].filter((time) => currentTimes.has(time))
        );

        // Yahoo's last bar may still be forming. Only bars preceding the last bar are considered complete.
        let addedCompletedBar = false;
        for (const bar of bars.slice(0, -1)) {
            if (!completedCandleTimes.has(bar.time)) {
                completedCandleTimes.add(bar.time);
                pendingCompletedCandles.push(bar);
                addedCompletedBar = true;
            }
        }

        // If a write fails, retry on the next newly completed candle, not every polling cycle.
        if (addedCompletedBar && pendingCompletedCandles.length >= CANDLE_BATCH_SIZE) {
            const saved = await saveToSupabase();
            if (saved) pendingCompletedCandles = [];
        }

        const statusEl = document.getElementById('index-status');
        if (statusEl) {
            statusEl.innerText = 'Yahoo Finance · 5 分鐘（可能延遲）';
            statusEl.style.color = '#9ca3af';
        }
    } catch (error) {
        console.warn('行情更新失敗；保留目前圖表資料：', error);
        const statusEl = document.getElementById('index-status');
        if (statusEl) {
            statusEl.innerText = '⚠ 行情更新失敗，顯示上次取得的資料';
            statusEl.style.color = '#f59e0b';
        }
    } finally {
        isPollingMarket = false;
    }
}

function renderPriceSummary(candle) {
    const priceEl = document.getElementById('current-price');
    const changeEl = document.getElementById('price-change');
    if (!priceEl || !changeEl || !candle) return;

    const base = Number(candle.open) || Number(candle.close) || 0;
    const diff = Number((candle.close - base).toFixed(2));
    const percent = base > 0 ? ((diff / base) * 100).toFixed(2) : '0.00';

    priceEl.innerText = Number(candle.close).toFixed(2);
    if (diff >= 0) {
        priceEl.className = 'current-price text-green';
        changeEl.className = 'price-change text-green';
        changeEl.innerText = '+' + diff.toFixed(2) + ' (+' + percent + '%)';
    } else {
        priceEl.className = 'current-price text-red';
        changeEl.className = 'price-change text-red';
        changeEl.innerText = diff.toFixed(2) + ' (' + percent + '%)';
    }
}

function updateMarketStatusText() {
    const statusEl = document.getElementById('index-status');
    if (statusEl && !statusEl.innerText) {
        statusEl.innerText = '正在連線至 5 分鐘行情 API…';
    }
}

async function saveToSupabase() {
    if (!supabaseClient || !candleList.length) return false;

    // Persist completed candles only; keep the in-progress bar in memory.
    const completedHistory = candleList
        .filter((bar) => completedCandleTimes.has(bar.time))
        .slice(-MAX_HISTORY_LIMIT);
    if (!completedHistory.length) return false;

    const last = completedHistory[completedHistory.length - 1];
    const { error } = await supabaseClient
        .from('stock_data')
        .update({
            history: completedHistory,
            active_state: { open: last.open, high: last.high, low: last.low, close: last.close }
        })
        .eq('id', 1);

    if (error) {
        console.error('批次儲存已完成 K 線失敗：', error);
        return false;
    }
    return true;
}

initApp();
