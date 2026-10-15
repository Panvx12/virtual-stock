// ----------------------------------------------------
// Articles Component (獨立文章模組)
// ----------------------------------------------------

let articlesList = [];

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
            if (!typeof currentUser !== 'undefined' && !currentUser) {
                alert('請先登入會員。');
                return;
            }

            const title = document.getElementById('article-title-input').value.trim();
            const content = document.getElementById('article-content-input').value.trim();

            if (!title || !content) {
                alert('請填寫標題與內容！');
                return;
            }

            const authorEmail = currentUser && currentUser.email ? currentUser.email.split('@')[0] : '訪客';
            const nowTime = new Date().toISOString().replace('T', ' ').substring(0, 19);

            const newArticle = {
                id: Date.now(),
                author: authorEmail,
                title: title,
                content: content,
                created_at: nowTime
            };

            // 存入陣列最前方
            articlesList.unshift(newArticle);

            // 清空輸入框並隱藏表單
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
        listEl.innerHTML = `<p class="empty-msg">目前尚無討論文章，登入後搶先發表！</p>`;
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