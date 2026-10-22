(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.('#17121b');
  tg?.setBackgroundColor?.('#17121b');

  const $ = (selector) => document.querySelector(selector);
  let searchTimer;
  const labels = {
    pending: 'Новая', in_review: 'На рассмотрении', approved: 'Одобрена',
    rejected: 'Отклонена', need_info: 'Нужны данные'
  };
  const actionLabels = {
    in_review: 'Взять в работу', need_info: 'Запросить данные',
    approved: 'Одобрить', rejected: 'Отклонить'
  };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const safeDate = (value) => {
    if (!value) return 'Дата не указана';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.add('hidden'), 3600);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': tg?.initData || '',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.detail;
      throw new Error(Array.isArray(message) ? message.map(x => x.msg).join(', ') : (message || 'Не удалось выполнить запрос'));
    }
    return body;
  }
  function emptyState(title, description, icon = '♡') {
    return '<div class="empty-state"><span class="empty-icon">' + icon + '</span><strong>' + esc(title) + '</strong><p>' + esc(description) + '</p></div>';
  }
  function renderAppeal(appeal, staff = false) {
    let evidence = [];
    try {
      evidence = JSON.parse(appeal.evidence_json || '[]');
      if (!Array.isArray(evidence)) evidence = [];
    } catch { evidence = []; }
    const links = evidence.filter(url => typeof url === 'string' && /^https:\/\//i.test(url))
      .map(url => '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Открыть ↗</a>').join(' · ');
    const note = appeal.moderator_note
      ? '<p><b>Комментарий команды:</b> ' + esc(appeal.moderator_note) + '</p>' : '';
    const staffInfo = staff
      ? '<p class="muted">Telegram ID: ' + esc(appeal.telegram_user_id) + '</p>' : '';
    const actions = staff
      ? '<div class="actions">' + Object.entries(actionLabels).map(([status, label]) =>
          '<button data-decision="' + status + '" data-id="' + esc(appeal.id) + '">' + label + '</button>'
        ).join('') + '</div>' : '';
    return '<article class="appeal"><div class="appeal-top"><div><h3>Заявка #' +
      esc(appeal.id) + ' · ' + esc(appeal.minecraft_nickname) + '</h3><p class="muted">' +
      safeDate(appeal.created_at) + '</p>' + staffInfo + '</div><span class="status ' +
      esc(appeal.status) + '">' + esc(labels[appeal.status] || appeal.status) +
      '</span></div><p><b>Дата бана:</b> ' + esc(appeal.ban_date || 'Не указана') + '</p><p><b>Причина бана:</b> ' + esc(appeal.ban_reason) +
      '</p><p><b>Апелляция:</b> ' + esc(appeal.appeal_text) + '</p>' +
      (links ? '<p><b>Доказательства:</b> ' + links + '</p>' : '') + note + actions + '</article>';
  }
  async function loadAppeals() {
    const target = $('#appeal-list');
    target.innerHTML = '<div class="loading"><span class="spinner"></span> Загружаем заявки…</div>';
    try {
      const data = await api('/api/appeals');
      target.innerHTML = data.items.length
        ? data.items.map(item => renderAppeal(item)).join('')
        : emptyState('Заявок пока нет', 'Если нужно обжаловать бан, создай первую апелляцию.', '✦');
    } catch (error) {
      target.innerHTML = emptyState('Не получилось загрузить', error.message, '!');
    }
  }
  async function loadModeration() {
    const target = $('#moderation-list');
    target.innerHTML = '<div class="loading"><span class="spinner"></span> Загружаем очередь…</div>';
    try {
      const params = new URLSearchParams();
      if ($('#status-filter').value) params.set('status', $('#status-filter').value);
      if ($('#search').value.trim()) params.set('q', $('#search').value.trim());
      const data = await api('/api/moderation/appeals?' + params.toString());
      target.innerHTML = data.items.length
        ? data.items.map(item => renderAppeal(item, true)).join('')
        : emptyState('Очередь чиста', 'По выбранным фильтрам заявок не найдено.', '✓');
    } catch (error) {
      target.innerHTML = emptyState('Нет доступа или ошибка', error.message, '!');
    }
  }
  async function loadStats() {
    const target = $('#stats');
    target.innerHTML = '<div class="loading"><span class="spinner"></span> Собираем статистику…</div>';
    try {
      const data = await api('/api/admin/stats');
      const byStatus = data.by_status || {};
      target.innerHTML = '<div class="stat-grid">' +
        [['Всего заявок', data.total || 0], ['На рассмотрении', (byStatus.pending || 0) + (byStatus.in_review || 0) + (byStatus.need_info || 0)],
         ['Одобрено', byStatus.approved || 0], ['Отклонено', byStatus.rejected || 0]]
          .map(([label, count]) => '<article class="stat-card"><small>' + esc(label) + '</small><strong>' + esc(count) + '</strong></article>').join('') +
        '</div><div class="section-heading" style="margin:8px 0 0"><div><span class="eyebrow">ЖУРНАЛ</span><h2 style="font-size:16px;margin:0">Последние действия</h2></div></div>' +
        ((data.recent_audit_log || []).length
          ? data.recent_audit_log.map(item => '<article class="audit-item"><strong>' + esc(item.action) +
            (item.appeal_id ? ' · заявка #' + esc(item.appeal_id) : '') + '</strong><p>' +
            esc(safeDate(item.created_at)) + ' · ID ' + esc(item.actor_telegram_id) + '</p></article>').join('')
          : emptyState('Пока нет событий', 'Здесь появятся действия по заявкам.', '◷'));
    } catch (error) {
      target.innerHTML = emptyState('Статистика недоступна', error.message, '!');
    }
  }
  function show(viewName) {
    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    $('#view-' + viewName)?.classList.remove('hidden');
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === viewName));
    if (viewName === 'appeals') loadAppeals();
    if (viewName === 'moderation') loadModeration();
    if (viewName === 'admin') loadStats();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function start() {
    if (!tg?.initData) {
      $('#identity').textContent = 'Открой мини-приложение через Telegram';
      $('#greeting').textContent = 'Добро пожаловать!';
      $('#avatar').textContent = 'W';
      $('#appeal-list').innerHTML = emptyState('Открой WoonTime в Telegram', 'Для защиты аккаунта вход работает через официальное мини-приложение.', '♡');
      document.querySelectorAll('.tab').forEach(tab => { if (tab.dataset.view !== 'appeals') tab.disabled = true; });
      return;
    }
    try {
      const me = await api('/api/me');
      const firstName = me.telegram_user?.first_name || 'игрок';
      $('#greeting').textContent = 'Привет, ' + firstName + '!';
      $('#avatar').textContent = [...firstName][0]?.toUpperCase() || 'W';
      $('#identity').textContent = 'WoonTime ID · ' + me.user_id;
      if (['admin', 'moderator'].includes(me.role)) {
        document.querySelectorAll('.staff-only').forEach(tab => tab.classList.remove('hidden'));
      }
      if (me.role === 'admin') document.querySelectorAll('.admin-only').forEach(tab => tab.classList.remove('hidden'));
      await loadAppeals();
    } catch (error) {
      $('#identity').textContent = error.message;
      $('#appeal-list').innerHTML = emptyState('Не удалось войти', error.message, '!');
      toast(error.message);
    }
  }

  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => show(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => show(button.dataset.go)));
  $('#refresh').addEventListener('click', loadAppeals);
  $('#status-filter').addEventListener('change', loadModeration);
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadModeration, 250);
  });

  $('#appeal-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = new FormData(form);
    const evidence = String(values.get('evidence') || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const invalidLink = evidence.find(url => !/^https:\/\//i.test(url));
    if (invalidLink) {
      $('#form-message').textContent = 'Ссылки на доказательства должны начинаться с https://';
      return;
    }
    button.disabled = true;
    $('#form-message').textContent = 'Отправляем апелляцию…';
    try {
      const result = await api('/api/appeals', {
        method: 'POST',
        body: JSON.stringify({
          minecraft_nickname: values.get('minecraft_nickname'),
          ban_date: values.get('ban_date') || '',
          ban_reason: values.get('ban_reason'),
          appeal_text: values.get('appeal_text'),
          evidence
        })
      });
      form.reset();
      $('#form-message').textContent = 'Заявка #' + result.id + ' успешно отправлена.';
      toast('Апелляция отправлена команде WoonTime');
      show('appeals');
    } catch (error) {
      $('#form-message').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-decision]');
    if (!button) return;
    const status = button.dataset.decision;
    let moderator_note = '';
    if (status === 'rejected' || status === 'need_info') {
      moderator_note = window.prompt(status === 'rejected' ? 'Укажи причину отказа:' : 'Какую информацию нужно запросить?') || '';
      if (!moderator_note.trim()) {
        toast('Добавь комментарий к этому решению');
        return;
      }
    } else if (status === 'approved') {
      const confirmed = tg?.showConfirm
        ? await new Promise(resolve => tg.showConfirm('Одобрить апелляцию #' + button.dataset.id + '?', resolve))
        : window.confirm('Одобрить апелляцию #' + button.dataset.id + '?');
      if (!confirmed) return;
    }
    button.disabled = true;
    try {
      await api('/api/moderation/appeals/' + encodeURIComponent(button.dataset.id), {
        method: 'PATCH', body: JSON.stringify({ status, moderator_note })
      });
      toast('Решение по заявке сохранено');
      await loadModeration();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });

  tg?.onEvent?.('themeChanged', () => {
    tg.setHeaderColor?.('#17121b');
    tg.setBackgroundColor?.('#17121b');
  });
  start();
})();