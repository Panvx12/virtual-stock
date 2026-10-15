// ----------------------------------------------------
// 獨立文章系統邏輯 (articles.js) - Supabase 雲端版
// ----------------------------------------------------

let articlesList = [];

document.addEventListener('DOMContentLoaded', () => {
    initArticlesApp();
});

async function initArticlesApp() {
    setupArticleListeners();
    await loadArticles();
}

function setupArticleListeners() {
    const btnNewArticle = document.getElementById('btn-new-article');
    const formContainer = document.getElementById('article-form-container');
    const btnCancel = document.getElementById('btn-cancel-article');
    const btnSubmit = document.getElementById('btn-submit-article');

    if (btnNewArticle) {
        btnNewArticle.addEventListener('click', async () => {
            const client = window.supabaseClient;
            if (!client) {
                alert('系統初始化中，請稍後再試。');
                return;
            }
            
            // 檢查會員是否已登入
            const { data: { session } } = await client.auth.getSession();
            if (!session || !session.user) {
                alert('請先點擊右上角登入會員，才能發佈文章！');
                return;
            }
            
            formContainer.style.display = formContainer.style.display === 'none' ? 'flex' : 'none';
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            formContainer.style.display = 'none';
            document.getElementById('article-title-input').value = '';
            document.getElementById('article-content-input').value = '';
        });
    }

    if (btnSubmit) {
        btnSubmit.addEventListener('click', async () => {
            const client = window.supabaseClient;
            if (!client) {
                alert('資料庫連線尚未初始化。');
                return;
            }

            const { data: { session } } = await client.auth.getSession();
            if (!session || !session.user) {
                alert('請先登入會員。');
                return;
            }

            const title = document.getElementById('article-title-input').value.trim();
            const content = document.getElementById('article-content-input').value.trim();

            if (!title || !content) {
                alert('請填寫標題與內容！');
                return;
            }

            const user = session.user;
            const authorEmail = user.email ? user.email.split('@')[0] : '匿名';

            // 寫入 Supabase 雲端資料庫
            const { error } = await client
                .from('articles')
                .insert([
                    {
                        user_id: user.id,
                        author: authorEmail,
                        title: title,
                        content: content
                    }
                ]);

            if (error) {
                alert('發佈失敗：' + error.message);
            } else {
                document.getElementById('article-title-input').value = '';
                document.getElementById('article-content-input').value = '';
                formContainer.style.display = 'none';
                await loadArticles();
                alert('文章發佈成功！');
            }
        });
    }
}

async function loadArticles() {
    const listEl = document.getElementById('articles-list');
    if (!listEl) return;

    const client = window.supabaseClient;
    if (!client) {
        // 如果 stock.js 還沒初始化完畢，稍後再試
        setTimeout(loadArticles, 300);
        return;
    }

    const { data, error } = await client
        .from('articles')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('無法從 Supabase 讀取文章', error);
        listEl.innerHTML = `<p class="empty-msg">讀取文章失敗或資料表尚未建立。</p>`;
        return;
    }

    articlesList = data || [];
    renderArticles();
}

function renderArticles() {
    const listEl = document.getElementById('articles-list');
    if (!listEl) return;

    if (!articlesList || articlesList.length === 0) {
        listEl.innerHTML = `<p class="empty-msg">目前尚無討論文章，登入後搶先發表！</p>`;
        return;
    }

    listEl.innerHTML = articlesList.map(article => {
        let dateStr = '';
        if (article.created_at) {
            const date = new Date(article.created_at);
            dateStr = date.toLocaleString('zh-TW', { hour12: false });
        }
        return `
            <div class="article-card">
                <div class="article-card-header">
                    <span class="article-card-title">${escapeHtml(article.title)}</span>
                    <span class="article-card-author">由 ${escapeHtml(article.author || '匿名')} 發表 (${dateStr})</span>
                </div>
                <div class="article-card-content">${escapeHtml(article.content)}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}