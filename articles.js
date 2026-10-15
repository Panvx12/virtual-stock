// ----------------------------------------------------
// 獨立文章系統邏輯 (articles.js)
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
        btnNewArticle.addEventListener('click', () => {
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
            const title = document.getElementById('article-title-input').value.trim();
            const content = document.getElementById('article-content-input').value.trim();

            if (!title || !content) {
                alert('請填寫標題與內容！');
                return;
            }

            const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

            const newArticle = {
                id: Date.now(),
                author: '訪客',
                title: title,
                content: content,
                created_at: nowTime
            };

            articlesList.unshift(newArticle);

            // 清空並隱藏
            document.getElementById('article-title-input').value = '';
            document.getElementById('article-content-input').value = '';
            formContainer.style.display = 'none';

            renderArticles();
            alert('文章發佈成功！');
        });
    }
}

async function loadArticles() {
    const listEl = document.getElementById('articles-list');
    if (!listEl) return;

    try {
        const response = await fetch('articles.json');
        if (response.ok) {
            articlesList = await response.json();
        } else {
            articlesList = [];
        }
    } catch (error) {
        console.warn('無法載入 articles.json，使用預設或空資料。', error);
        articlesList = [];
    }

    renderArticles();
}

function renderArticles() {
    const listEl = document.getElementById('articles-list');
    if (!listEl) return;

    if (!articlesList || articlesList.length === 0) {
        listEl.innerHTML = `<p class="empty-msg">目前尚無文章，點擊上方按鈕發佈第一篇文章吧！</p>`;
        return;
    }

    listEl.innerHTML = articlesList.map(article => `
        <div class="article-card">
            <div class="article-card-header">
                <span class="article-card-title">${escapeHtml(article.title)}</span>
                <span class="article-card-author">由 ${escapeHtml(article.author || '匿名')} 發表 (${article.created_at || ''})</span>
            </div>
            <div class="article-card-content">${escapeHtml(article.content)}</div>
        </div>
    `).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}