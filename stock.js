// ----------------------------------------------------
// 0. Dynamic import of Lightweight Charts & Supabase config
// ----------------------------------------------------
const CHART_SCRIPT_URL = 'https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js';

const SUPABASE_URL = 'https://jofmnltiasuvzozauwor.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_BLVholCvkP5hFi7lWLTVww_FHLu2JlF';

// 設定歷史 K 棒的最大保留數量上限（最多保留 500 筆）
const MAX_HISTORY_LIMIT = 500;
const UPDATE_FREQUENCY = 60000; // 💡 調整為 60 秒更新一次，符合 1 分鐘 K 棒頻率

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

// 🚀 Main Application Entry Point
async function initApp() {
    try {
        await loadScript(CHART_SCRIPT_URL);
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.supabaseClient = supabaseClient; // 讓 articles.js 能夠共用 Supabase 連線

        setupAuthListeners();
        setupTradingListeners();
        await checkUserSession();

        const chartContainer = document.getElementById('chart-container');
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
                secondsVisible: true,
                fixLeftEdge: true,
                rightOffset: 12,
            },
        });

        // 建立 K 線圖系列，並為 10 元股價設定精準的小數位數與格式
        candlestickSeries = chart.addCandlestickSeries({
            upColor: '#ef4444',      
            downColor: '#22c55e',    
            borderUpColor: '#ef4444',
            borderDownColor: '#22c55e',
            wickUpColor: '#ef4444',
            wickDownColor: '#22c55e',
            priceFormat: {
                type: 'price',
                precision: 2,
                minMove: 0.01,
            },
        });

        await loadStockData();

        setInterval(async () => {
            updateMarketStatusText();

            if (!checkTaiwanMarketOpen()) {
                return;
            }

            const trendData = await fetchTaiwanIndexTrend();
            if (!trendData) return;

            // 針對 10 元級距設計的合理價格跳動範圍
            const stockChange = (Math.random() - 0.48) * 0.08; 
            
            let newPrice = activeClose + stockChange;
            newPrice = parseFloat(newPrice.toFixed(2));
            if (newPrice < 0.5) newPrice = 0.5;

            activeClose = newPrice;

            // 讓 10 元股價也能長出漂亮的上下影線與實體方塊
            const wickSpread = 0.02 + (Math.random() * 0.05);
            const currentHigh = parseFloat((Math.max(activeOpen, activeClose) + wickSpread).toFixed(2));
            const currentLow = parseFloat((Math.min(activeOpen, activeClose) - wickSpread).toFixed(2));

            if (currentHigh > activeHigh) activeHigh = currentHigh;
            if (currentLow < activeLow) activeLow = currentLow;

            const nowTime = Math.floor(Date.now() / 1000);
            
            // 💡 每 60 秒（1分鐘）推進一根新的 K 棒
            if (nowTime - activeCandleTime >= 60) {
                const newCandle = {
                    time: activeCandleTime,
                    open: activeOpen,
                    high: activeHigh,
                    low: activeLow,
                    close: activeClose,
                };
                candleList.push(newCandle);

                // 檢查並限制陣列長度不超過上限，超出時切除最舊的資料
                if (candleList.length > MAX_HISTORY_LIMIT) {
                    candleList = candleList.slice(-MAX_HISTORY_LIMIT);
                    candlestickSeries.setData(candleList); 
                }

                activeCandleTime = nowTime;
                activeOpen = activeClose;
                activeHigh = activeClose;
                activeLow = activeClose;
            }

            const currentCandle = {
                time: activeCandleTime,
                open: activeOpen,
                high: activeHigh,
                low: activeLow,
                close: activeClose,
            };
            candlestickSeries.update(currentCandle);

            if (candleList.length > 0) {
                candleList[candleList.length - 1] = currentCandle;
            } else {
                candleList.push(currentCandle);
            }

            await saveToSupabase();

            const priceEl = document.getElementById('current-price');
            const changeEl = document.getElementById('price-change');
            if (priceEl) priceEl.innerText = activeClose.toFixed(2);
            
            // 即時計算相對於當日開盤價（activeOpen）的漲跌金額與百分比
            const diff = (activeClose - activeOpen).toFixed(2);
            const percent = activeOpen > 0 ? ((diff / activeOpen) * 100).toFixed(2) : '0.00';
            
            if (changeEl) {
                if (diff >= 0) {
                    if (priceEl) priceEl.className = "current-price text-green";
                    changeEl.className = "price-change text-green";
                    changeEl.innerText = `+${diff} (+${percent}%)`;
                } else {
                    if (priceEl) priceEl.className = "current-price text-red";
                    changeEl.className = "price-change text-red";
                    changeEl.innerText = `${diff} (${percent}%)`;
                }
            }

        }, UPDATE_FREQUENCY);

        window.addEventListener('resize', () => {
            chart.resize(chartContainer.clientWidth, 300);
        });

    } catch (error) {
        console.error('Application initialization failed:', error);
        const statusEl = document.getElementById('index-status');
        if (statusEl) statusEl.innerText = 'Loading failed; please check your network or script source.';
    }
}

// ----------------------------------------------------
// Authentication & Wallet Functions
// ----------------------------------------------------
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
        if (session && session.user) {
            currentUser = session.user;
            await loadUserWallet(currentUser.id);
        } else {
            currentUser = null;
            userWallet = { cash: 100000, shares: 0, username: '' };
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

// ----------------------------------------------------
// Helper Functions (Calendar & Smart Trend Simulation)
// ----------------------------------------------------
async function loadTaiwanCalendar() {
    try {
        const now = new Date();
        const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(now);
        const url = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
        const response = await fetch(url);
        const data = await response.json();
        data.forEach(item => { holidayMap[item.date] = item.isHoliday; });
    } catch (error) {
        console.error('Failed to load Taiwan calendar', error);
    }
}

function checkTaiwanMarketOpen() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
    const dateParts = formatter.formatToParts(now);
    let y = '', m = '', d = '';
    dateParts.forEach(p => {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') m = p.value;
        if (p.type === 'day') d = p.value;
    });
    const dateKey = `${y}${m}${d}`;
    
    if (holidayMap[dateKey] !== undefined) {
        if (holidayMap[dateKey]) return false;
    } else {
        const timeFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
        const weekday = timeFormatter.format(now);
        if (weekday === 'Sat' || weekday === 'Sun') return false;
    }
    
    const timeFormatterDetail = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' });
    const parts = timeFormatterDetail.formatToParts(now);
    let hour = 0, minute = 0;
    parts.forEach(p => {
        if (p.type === 'hour') hour = parseInt(p.value, 10);
        if (p.type === 'minute') minute = parseInt(p.value, 10);
    });
    
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= (9 * 60) && totalMinutes <= (13 * 60 + 30);
}

async function fetchTaiwanIndexTrend() {
    const randomPercent = (Math.random() - 0.49) * 0.8; 
    return { 
        percentChange: randomPercent, 
        totalDayPercent: randomPercent 
    };
}

async function loadStockData() {
    await loadTaiwanCalendar();
    const { data, error } = await supabaseClient.from('stock_data').select('*').eq('id', 1).single();

    if (error) return;

    if (data && data.history && data.history.length > 0) {
        candleList = data.history;

        if (candleList.length > MAX_HISTORY_LIMIT) {
            candleList = candleList.slice(-MAX_HISTORY_LIMIT);
        }

        candlestickSeries.setData(candleList);
        chart.timeScale().fitContent();

        const lastCandle = candleList[candleList.length - 1];
        activeClose = lastCandle.close;
        activeOpen = lastCandle.open;
        activeHigh = lastCandle.high;
        activeLow = lastCandle.low;
        activeCandleTime = lastCandle.time;
    } else {
        candleList = [];
    }
    updateMarketStatusText();
    
    // 載入歷史資料後立即更新一次畫面的價格與百分比
    const priceEl = document.getElementById('current-price');
    const changeEl = document.getElementById('price-change');
    if (priceEl && changeEl) {
        priceEl.innerText = activeClose.toFixed(2);
        const diff = (activeClose - activeOpen).toFixed(2);
        const percent = activeOpen > 0 ? ((diff / activeOpen) * 100).toFixed(2) : '0.00';
        if (diff >= 0) {
            priceEl.className = "current-price text-green";
            changeEl.className = "price-change text-green";
            changeEl.innerText = `+${diff} (+${percent}%)`;
        } else {
            priceEl.className = "current-price text-red";
            changeEl.className = "price-change text-red";
            changeEl.innerText = `${diff} (${percent}%)`;
        }
    }
}

function updateMarketStatusText() {
    const isOpen = checkTaiwanMarketOpen();
    const statusEl = document.getElementById('index-status');
    if (statusEl) {
        if (isOpen) {
            statusEl.innerText = '🟢 Market Open';
            statusEl.style.color = '#22c55e';
        } else {
            statusEl.innerText = '🔴 Market Closed';
            statusEl.style.color = '#ef4444';
        }
    }
}

async function saveToSupabase() {
    await supabaseClient.from('stock_data').update({ 
        history: candleList,
        active_state: { open: activeOpen, high: activeHigh, low: activeLow, close: activeClose }
    }).eq('id', 1);
}

initApp();