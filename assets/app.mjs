import { mountPower } from './power-tool.mjs';
import { mountSurvey } from './survey.mjs';
import { mountQual } from './qual.mjs';
import { copyText } from './ui.mjs';

const homeTitle = 'MethodsDesk 研究方法工具箱';
const views = [...document.querySelectorAll('.view')];
const navigation = [...document.querySelectorAll('[data-nav]')];
const catalog = document.querySelector('#tools');

function showView(focusHeading = false) {
  const id = location.hash.slice(1);
  const view = views.find((item) => item.id === id) ?? views[0];
  const heading = id === 'tools' ? catalog.querySelector('h2') : view.querySelector('h1');
  views.forEach((item) => { item.hidden = item !== view; });

  document.title = view.id === 'home' ? homeTitle : `${heading.textContent} | MethodsDesk`;
  for (const link of navigation) {
    const active = link.dataset.nav === (view.id === 'about' ? 'about' : 'tools');
    if (active) link.setAttribute('aria-current', view.dataset.tool === undefined ? 'page' : 'true');
    else link.removeAttribute('aria-current');
  }
  if (focusHeading) {
    if (id === 'tools') catalog.scrollIntoView();
    else window.scrollTo(0, 0);
    heading.focus({ preventScroll: true });
  }
}

function mountCatalog() {
  const filters = [...catalog.querySelectorAll('[data-filter]')];
  const groups = [...catalog.querySelectorAll('[data-tool-kind]')];
  const status = catalog.querySelector('#catalog-status');
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      const kind = filter.dataset.filter;
      filters.forEach((button) => button.setAttribute('aria-pressed', String(button === filter)));
      for (const group of groups) group.hidden = kind !== 'all' && group.dataset.toolKind !== kind;
      catalog.dataset.selection = kind;
      status.textContent = kind === 'all' ? '显示全部工具。' : `显示${filter.textContent}工具。`;
    });
  }
}

function mountToolNavigation() {
  const template = document.querySelector('#tool-navigation');
  for (const view of views.filter((item) => item.hasAttribute('data-tool'))) {
    const fragment = template.content.cloneNode(true);
    const share = fragment.querySelector('.share-button');
    const feedback = fragment.querySelector('.tool-share-feedback');
    const fallback = fragment.querySelector('.tool-share-fallback');
    const field = fallback.querySelector('input');

    share.addEventListener('click', async () => {
      const url = new URL(location.href);
      url.hash = view.id;
      url.search = '';
      const copied = await copyText(url.href);
      feedback.hidden = false;
      feedback.textContent = copied ? '工具链接已复制。' : '请复制下方的工具链接。';
      fallback.hidden = copied;
      if (!copied) {
        field.value = url.href;
        field.focus();
        field.select();
      }
    });
    view.querySelector('.tool-heading').prepend(fragment);
  }
}

mountPower();
mountSurvey();
mountQual();
mountCatalog();
mountToolNavigation();
showView();
if (location.hash === '#tools') requestAnimationFrame(() => catalog.scrollIntoView());

document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('main').focus();
});
window.addEventListener('hashchange', () => showView(true));
