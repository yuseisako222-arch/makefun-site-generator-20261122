// Implements the makefun-site 1.0.0 input and output dialect.

const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const htmlSpecial = /[&<>"']/;
const allHtmlSpecial = /[&<>"']/g;
const htmlEntity = (character) => htmlEntities[character];
const escapeHtml = (text) => htmlSpecial.test(text) ? text.replace(allHtmlSpecial, htmlEntity) : text;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function slugify(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-/, '')
    .slice(0, 64).replace(/-$/, '').toLowerCase() || 'untitled';
}

// Each occupied slug also records the next suffix worth trying for that slug.
function takeSlug(base, used) {
  let suffix = used.get(base);
  if (suffix === undefined) {
    used.set(base, 2);
    return base;
  }
  let candidate;
  do candidate = base + '-' + suffix++;
  while (used.has(candidate));
  used.set(base, suffix);
  used.set(candidate, 2);
  return candidate;
}

// Front matter

const fields = new Set(['title', 'summary', 'date', 'tags', 'draft', 'slug', 'layout']);
const headerEnd = /\n---(?=\n|$)/g;
const headerField = /^([a-z_]+):(?: (.*))?$/;
const horizontalBlank = /^[ \t]*$/;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthDays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function validDate(text) {
  const match = datePattern.exec(text);
  if (!match) return false;
  const year = +match[1], month = +match[2], day = +match[3];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1970 && year <= 2099 && day >= 1 &&
    day <= monthDays[month] + (month === 2 && leap ? 1 : 0);
}

function dateInWords(date) {
  if (!date) return '';
  return Number(date.slice(8)) + ' ' + months[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
}

function parseHeader(text) {
  if (!text.startsWith('---\n') && text !== '---') return 'no front matter';
  headerEnd.lastIndex = 3;
  const closing = headerEnd.exec(text);
  if (!closing) return 'the front matter is not closed';

  const data = Object.create(null);
  const lines = text.slice(4, closing.index).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line[0] === '#' || horizontalBlank.test(line)) continue;
    const match = headerField.exec(line);
    if (!match) return 'line ' + (i + 2) + ' is not "key: value"';
    const key = match[1];
    if (!fields.has(key)) return 'unknown key "' + key + '"';
    if (Object.hasOwn(data, key)) return 'key "' + key + '" is given twice';
    let value = (match[2] ?? '').replace(/[ \t]+$/, '');
    if (value === '') return 'key "' + key + '" has no value';
    const prefix = 'key "' + key + '": ';
    switch (key) {
      case 'title':
      case 'summary':
        if (value[0] === '[') return prefix + 'a bare string opens on [';
        if (value[0] === '"') {
          if (value.length < 2 || !value.endsWith('"')) return prefix + 'a quoted string is not closed';
          const inner = value.slice(1, -1);
          const quotes = /\\["\\]|(\\)|(")/g;
          let decoded = '';
          let from = 0;
          for (let part; (part = quotes.exec(inner));) {
            if (part[1]) return prefix + 'a quoted string holds an escape other than \\" or \\\\';
            if (part[2]) return prefix + 'a quoted string holds a stray quote';
            decoded += inner.slice(from, part.index) + part[0][1];
            from = quotes.lastIndex;
          }
          value = decoded + inner.slice(from);
        }
        break;
      case 'date':
        if (!validDate(value)) return prefix + 'not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
        break;
      case 'tags': {
        if (value[0] !== '[' || !value.endsWith(']')) return prefix + 'not a list [a, b]';
        const inner = value.slice(1, -1);
        value = [];
        if (inner.trim() === '') break;
        for (const part of inner.split(',')) {
          const tag = part.trim();
          if (tag === '' || /["[\]]/.test(tag)) return prefix + 'an empty tag, or one holding " [ or ]';
          value.push(tag);
        }
        break;
      }
      case 'draft':
        if (value !== 'true' && value !== 'false') return prefix + 'true or false';
        value = value === 'true';
        break;
      case 'slug':
        if (value.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return prefix + 'not a slug';
        break;
      case 'layout':
        if (!/^[a-z0-9-]+$/.test(value)) return prefix + 'not a template name';
        break;
    }
    data[key] = value;
  }
  if (data.title === undefined) return 'no title';
  return { data, body: text.slice(closing.index + 5) };
}

// Templates

const templateOpen = /\{\{\{?|\{%/g;
const validPath = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const forTag = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const ifTag = /^if (not )?(\S+)$/;
const includeTag = /^include "([a-z0-9-]+)"$/;

function splitPath(text) {
  if (!validPath.test(text)) throw new SyntaxError(JSON.stringify(text) + ' is not a path');
  return text.split('.');
}

function templateTokens(source) {
  const tokens = [];
  let position = 0;
  templateOpen.lastIndex = 0;
  for (let token; (token = templateOpen.exec(source));) {
    const opener = token[0];
    const isTag = opener === '{%';
    const closer = isTag ? '%}' : opener.length === 3 ? '}}}' : '}}';
    const start = templateOpen.lastIndex;
    const stop = source.indexOf(closer, start);
    if (stop < 0) throw new SyntaxError('a ' + opener + ' is not closed');

    let textEnd = token.index;
    let next = stop + closer.length;
    if (isTag) {
      const lineStart = source.lastIndexOf('\n', token.index - 1) + 1;
      const newline = source.indexOf('\n', next);
      const lineEnd = newline < 0 ? source.length : newline;
      if (horizontalBlank.test(source.slice(lineStart, token.index)) &&
          horizontalBlank.test(source.slice(next, lineEnd))) {
        textEnd = lineStart;
        next = newline < 0 ? lineEnd : newline + 1;
      }
    }
    if (position < textEnd) tokens.push(source.slice(position, textEnd));
    const content = source.slice(start, stop).trim();
    if (isTag) tokens.push({ kind: 'tag', content });
    else tokens.push({ kind: opener.length === 3 ? 'raw' : 'var', path: splitPath(content) });
    position = next;
    templateOpen.lastIndex = next;
  }
  if (position < source.length) tokens.push(source.slice(position));
  return tokens;
}

function parseTemplate(source, includes) {
  const root = [];
  const stack = [];
  let body = root;
  for (const token of templateTokens(source)) {
    if (token.kind !== 'tag') {
      body.push(token);
      continue;
    }
    const tag = token.content;
    const top = stack[stack.length - 1];
    let match;
    if ((match = forTag.exec(tag))) {
      const node = { kind: 'for', name: match[1], path: splitPath(match[2]), body: [] };
      body.push(node);
      stack.push({ node, parent: body });
      body = node.body;
    } else if ((match = ifTag.exec(tag))) {
      const node = { kind: 'if', negate: match[1] !== undefined, path: splitPath(match[2]), yes: [], no: null };
      body.push(node);
      stack.push({ node, parent: body });
      body = node.yes;
    } else if (tag === 'else') {
      if (top?.node.kind !== 'if' || top.node.no !== null) throw new SyntaxError('an else outside an if');
      body = top.node.no = [];
    } else if (tag === 'endif' || tag === 'endfor') {
      const kind = tag.slice(3);
      if (top?.node.kind !== kind) throw new SyntaxError('an ' + tag + ' with no open ' + kind);
      stack.pop();
      body = top.parent;
    } else if ((match = includeTag.exec(tag))) {
      const node = { kind: 'include', name: match[1], body: undefined };
      includes.push(node);
      body.push(node);
    } else {
      throw new SyntaxError('{% ' + tag + ' %} is not a tag');
    }
  }
  if (stack.length) throw new SyntaxError('a ' + stack[stack.length - 1].node.kind + ' is not closed');
  return root;
}

function readPath(scope, path) {
  let value = scope[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, path[i])) return undefined;
    value = value[path[i]];
  }
  return value;
}

function valueText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  return '';
}

function templateTruth(value) {
  return value !== undefined && value !== null && value !== false && value !== '' && value !== 0 &&
    (!Array.isArray(value) || value.length > 0);
}

function renderTemplate(nodes, scope, depth = 0) {
  let html = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      html += node;
      continue;
    }
    switch (node.kind) {
      case 'var':
        html += escapeHtml(valueText(readPath(scope, node.path)));
        break;
      case 'raw':
        html += valueText(readPath(scope, node.path));
        break;
      case 'if': {
        const branch = templateTruth(readPath(scope, node.path)) !== node.negate ? node.yes : node.no;
        if (branch !== null) html += renderTemplate(branch, scope, depth);
        break;
      }
      case 'for': {
        const items = readPath(scope, node.path);
        if (!Array.isArray(items) || items.length === 0) break;
        const previous = scope[node.name];
        const outerLoop = scope.loop;
        const length = items.length;
        const loop = { index: 0, first: true, last: false, length };
        for (let i = 0; i < length; i++) {
          if (!Object.hasOwn(items, i)) continue;
          loop.index = i + 1;
          loop.first = i === 0;
          loop.last = i === length - 1;
          scope[node.name] = items[i];
          scope.loop = loop;
          html += renderTemplate(node.body, scope, depth);
        }
        scope[node.name] = previous;
        scope.loop = outerLoop;
        break;
      }
      case 'include':
        if (depth < 8 && node.body !== undefined) html += renderTemplate(node.body, scope, depth + 1);
        break;
    }
  }
  return html;
}

// Markdown

const inlineSpecial = /[&<>"'\\`*[]/g;
const escapable = '\\`*_[]()#+-.!>';
const targetSpace = /\s/;

function nextDelimiter(text, delimiter, from) {
  for (let index = text.indexOf(delimiter, from); index !== -1; index = text.indexOf(delimiter, index + 1)) {
    let previous = index;
    while (previous > from && text.charCodeAt(previous - 1) === 92) previous--;
    if ((index - previous) % 2 !== 0) continue;
    if (delimiter === '*' && text[index + 1] === '*') {
      index++;
      continue;
    }
    return index;
  }
  return -1;
}

function renderInline(text, link) {
  let html = '';
  let from = 0;
  inlineSpecial.lastIndex = 0;
  while (inlineSpecial.test(text)) {
    const index = inlineSpecial.lastIndex - 1;
    if (index > from) html += text.slice(from, index);
    const character = text[index];
    from = index + 1;
    switch (character) {
      case '\\':
        if (from < text.length && escapable.includes(text[from])) {
          html += htmlEntities[text[from]] ?? text[from];
          from++;
        } else html += character;
        break;
      case '`': {
        const end = text.indexOf(character, from);
        if (end > from) {
          html += '<code>' + escapeHtml(text.slice(from, end)) + '</code>';
          from = end + 1;
        } else html += character;
        break;
      }
      case '*': {
        const strong = text[from] === '*';
        const delimiter = strong ? '**' : '*';
        if (strong) from++;
        const end = nextDelimiter(text, delimiter, from);
        if (end > from) {
          html += (strong ? '<strong>' : '<em>') + renderInline(text.slice(from, end), link) +
            (strong ? '</strong>' : '</em>');
          from = end + delimiter.length;
        } else html += delimiter;
        break;
      }
      case '[': {
        const labelEnd = nextDelimiter(text, ']', from);
        const end = labelEnd >= 0 && text[labelEnd + 1] === '(' ? text.indexOf(')', labelEnd + 2) : -1;
        if (end > labelEnd + 2) {
          const target = text.slice(labelEnd + 2, end);
          if (!targetSpace.test(target)) {
            html += '<a href="' + escapeHtml(link(target)) + '">' +
              renderInline(text.slice(from, labelEnd), link) + '</a>';
            from = end + 1;
            break;
          }
        }
        html += character;
        break;
      }
      default:
        html += htmlEntities[character];
    }
    // A recursive span uses the same scanner on its own text.
    inlineSpecial.lastIndex = from;
  }
  return from === 0 ? text : html + text.slice(from);
}

const fenceOpen = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const fenceClose = /^```[ \t]*$/;
const headingLine = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const thematicBreak = /^(?:---|\*\*\*)[ \t]*$/;
const bulletItem = /^[-*] (.*)$/;
const orderedItem = /^(\d{1,9})\. (.*)$/;
const continuation = /^ {2,}\S/;

function trimLine(line) {
  let start = 0;
  let end = line.length;
  while (start < end && (line[start] === ' ' || line[start] === '\t')) start++;
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
  return line.slice(start, end);
}

function paragraphEnds(line) {
  switch (line.charCodeAt(0)) {
    case 32:
    case 9:
      return horizontalBlank.test(line);
    case 35:
      return Boolean(headingLine.exec(line)?.[2]);
    case 96:
      return fenceOpen.test(line);
    case 45:
    case 42:
      return thematicBreak.test(line);
    default:
      return line.length === 0;
  }
}

function renderMarkdown(body, link) {
  const lines = body.split('\n');
  const headings = new Map();
  const toc = [];
  let html = '';
  let excerpt;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    const first = line.charCodeAt(0);
    if (line === '' || ((first === 32 || first === 9) && horizontalBlank.test(line))) continue;

    if (first === 96) {
      const fence = fenceOpen.exec(line);
      if (fence) {
        const start = i;
        while (i < lines.length && !fenceClose.test(lines[i])) i++;
        const code = i === start ? '' : lines.slice(start, i).join('\n') + '\n';
        const cls = fence[1] === '' ? '' : ' class="language-' + fence[1] + '"';
        html += '<pre><code' + cls + '>' + escapeHtml(code) + '</code></pre>\n';
        i++;
        continue;
      }
    }
    if (first === 35) {
      const heading = headingLine.exec(line);
      if (heading?.[2]) {
        const level = heading[1].length;
        const id = takeSlug(slugify(heading[2]), headings);
        const title = renderInline(heading[2], link);
        html += '<h' + level + ' id="' + id + '">' + title + '</h' + level + '>\n';
        if (level === 2 || level === 3) toc.push({ level, id, html: title });
        continue;
      }
    }
    if ((first === 45 || first === 42) && thematicBreak.test(line)) {
      html += '<hr>\n';
      continue;
    }
    if (first === 62) {
      let quote = '';
      let current = line;
      do {
        const part = trimLine(current.slice(1));
        if (part !== '') quote += (quote === '' ? '' : '\n') + part;
        current = lines[i];
        if (current?.[0] !== '>') break;
        i++;
      } while (true);
      html += '<blockquote>\n';
      if (quote !== '') html += '<p>' + renderInline(quote, link) + '</p>\n';
      html += '</blockquote>\n';
      continue;
    }

    const bullet = first === 45 || first === 42;
    const ordered = first >= 48 && first <= 57;
    const marker = bullet ? bulletItem : ordered ? orderedItem : null;
    let item = marker?.exec(line);
    if (item) {
      const start = ordered ? Number(item[1]) : 1;
      html += ordered ? (start === 1 ? '<ol>\n' : '<ol start="' + start + '">\n') : '<ul>\n';
      do {
        let text = trimLine(item[ordered ? 2 : 1]);
        while (i < lines.length && continuation.test(lines[i])) text += '\n' + trimLine(lines[i++]);
        html += '<li>' + renderInline(text, link) + '</li>\n';
        item = i < lines.length ? marker.exec(lines[i]) : null;
        if (item) i++;
      } while (item);
      html += ordered ? '</ol>\n' : '</ul>\n';
      continue;
    }

    let paragraph = trimLine(line);
    while (i < lines.length && !paragraphEnds(lines[i])) paragraph += '\n' + trimLine(lines[i++]);
    const rendered = renderInline(paragraph, link);
    excerpt ??= rendered;
    html += '<p>' + rendered + '</p>\n';
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

// Site build

function resolveRelative(directory, relative) {
  if (relative !== '.' && relative !== '..' && !relative.includes('/')) {
    return directory === '' ? relative : directory + '/' + relative;
  }
  const parts = directory === '' ? [] : directory.split('/');
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

function renderBody(source, base, bySource, staticPaths, broken) {
  return renderMarkdown(source.body, (target) => {
    if (target[0] === '/' || target[0] === '#' ||
        (target.includes(':') && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target))) return target;
    const hash = target.indexOf('#');
    const relative = hash === -1 ? target : target.slice(0, hash);
    const fragment = hash === -1 ? '' : target.slice(hash);
    const path = resolveRelative(source.directory, relative);
    if (path !== null) {
      const page = bySource.get(path);
      if (page !== undefined) return page + fragment;
      if (staticPaths.has(path)) return base + '/' + path + fragment;
    }
    broken.add('broken-link ' + source.path + ' -> ' + target);
    return target;
  });
}

function neighbor(source) {
  if (!source) return null;
  const { title, url, date, date_long } = source.card;
  return { title, url, date, date_long };
}

const word = /\S+/g;

function readingMinutes(body) {
  // Two one-character words need at least one separator, so 400 code units hold at most 200 words.
  if (body.length <= 400) return 1;
  let words = 0;
  while (word.test(body)) words++;
  return Math.max(1, Math.ceil(words / 200));
}

function collectTags(sources, posts, base) {
  const bySlug = new Map();
  const nameSlugs = new Map();
  // Posts establish canonical tag names before ordinary pages contribute their tag links.
  for (const source of [...posts, ...sources.filter((page) => !page.isPost)]) {
    const seen = new Set();
    for (const name of source.data.tags ?? []) {
      let slug = nameSlugs.get(name);
      if (slug === undefined) {
        slug = slugify(name);
        nameSlugs.set(name, slug);
      }
      if (seen.has(slug)) continue;
      seen.add(slug);
      let group = bySlug.get(slug);
      if (source.isPost) {
        if (!group) {
          group = { info: { name, slug, url: base + '/tags/' + slug + '/' }, posts: [] };
          bySlug.set(slug, group);
        }
        group.posts.push(source.card);
      }
      source.card.tags.push(group?.info ?? { name, slug, url: '' });
    }
  }
  return [...bySlug.values()].sort((a, b) => b.posts.length - a.posts.length || compare(a.info.slug, b.info.slug));
}

export function run(input) {
  const report = [];
  const templates = new Map();
  const includes = [];
  for (const name of Object.keys(input.templates).sort()) {
    try {
      templates.set(name, parseTemplate(input.templates[name], includes));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      report.push('template "' + name + '": ' + error.message);
    }
  }
  for (const node of includes) node.body = templates.get(node.name);

  const base = input.site.base_url.replace(/\/+$/, '');
  const sources = [];
  const posts = [];
  const statics = [];
  const staticPaths = new Set();
  const bySource = new Map();
  const directories = new Map([['', new Map([['posts', 2], ['tags', 2], ['page', 2]])]]);
  const files = input.files.slice().sort((a, b) => compare(a.path, b.path));
  for (const file of files) {
    const { path, content } = file;
    if (!path.endsWith('.md')) {
      statics.push(file);
      staticPaths.add(path);
      continue;
    }
    const parsed = parseHeader(content.replace(/\r\n?/g, '\n'));
    const isPost = path.startsWith('posts/');
    const layout = parsed.data?.layout ?? (isPost ? 'post' : 'page');
    let refusal;
    if (typeof parsed === 'string') refusal = parsed;
    else if (path.startsWith('tags/')) refusal = "tags/ is the generator's own";
    else if (path.startsWith('page/')) refusal = "page/ is the generator's own";
    else if (isPost && !parsed.data.date) refusal = 'a post needs a date';
    else if (!templates.has(layout)) refusal = 'layout "' + layout + '" is no template that parses';
    if (refusal !== undefined) {
      report.push('refused ' + path + ': ' + refusal);
      continue;
    }

    const { data, body } = parsed;
    if (data.draft === true) {
      report.push('draft ' + path);
      continue;
    }
    const slash = path.lastIndexOf('/');
    const directory = slash < 0 ? '' : path.slice(0, slash);
    const outputDirectory = isPost ? 'posts' : directory;
    let used = directories.get(outputDirectory);
    if (used === undefined) directories.set(outputDirectory, used = new Map());
    const slug = takeSlug(data.slug ?? slugify(data.title), used);
    const outDir = outputDirectory === '' ? slug : outputDirectory + '/' + slug;
    const url = base + '/' + outDir + '/';
    const source = { data, body, path, directory, slug, outDir, isPost, layout,
      card: {
        title: data.title, url, date: data.date ?? '', date_long: dateInWords(data.date),
        summary: data.summary ?? '', excerpt: '', reading_minutes: 1, tags: [],
      },
    };
    bySource.set(path, url);
    sources.push(source);
    if (isPost) posts.push(source);
  }

  const broken = new Set();
  for (const source of sources) {
    source.markdown = renderBody(source, base, bySource, staticPaths, broken);
    source.card.excerpt = source.markdown.excerpt;
    source.card.reading_minutes = readingMinutes(source.body);
  }
  posts.sort((a, b) => compare(b.card.date, a.card.date) || compare(a.slug, b.slug));
  const tags = collectTags(sources, posts, base);
  for (let i = 0; i < posts.length; i++) {
    posts[i].newer = neighbor(posts[i - 1]);
    posts[i].older = neighbor(posts[i + 1]);
  }
  const cards = posts.map((source) => source.card);
  const scope = Object.assign(Object.create(null), {
    site: { title: input.site.title, base_url: base },
    recent: cards.slice(0, input.site.recent),
    tags: tags.map(({ info, posts }) => ({ ...info, count: posts.length })),
  });

  const output = {};
  for (const source of sources) {
    scope.page = {
      ...source.card,
      slug: source.slug, content: source.markdown.html, toc: source.markdown.toc,
      newer: source.newer ?? null, older: source.older ?? null, is_post: source.isPost,
    };
    output[source.outDir + '/index.html'] = renderTemplate(templates.get(source.layout), scope);
  }
  scope.page = undefined;
  const index = templates.get('index');
  if (index !== undefined) {
    const perPage = input.site.per_page;
    const total = Math.max(1, Math.ceil(cards.length / perPage));
    const indexUrl = (number) => number === 1 ? base + '/' : base + '/page/' + number + '/';
    for (let number = 1; number <= total; number++) {
      scope.posts = cards.slice((number - 1) * perPage, number * perPage);
      scope.pager = {
        number, total, url: indexUrl(number),
        newer_url: number === 1 ? '' : indexUrl(number - 1),
        older_url: number === total ? '' : indexUrl(number + 1),
      };
      const path = number === 1 ? 'index.html' : 'page/' + number + '/index.html';
      output[path] = renderTemplate(index, scope);
    }
    scope.posts = scope.pager = undefined;
  }
  const tag = templates.get('tag');
  if (tag !== undefined) {
    for (const group of tags) {
      scope.tag = { ...group.info, count: group.posts.length, posts: group.posts };
      output['tags/' + group.info.slug + '/index.html'] = renderTemplate(tag, scope);
    }
    scope.tag = undefined;
  }
  if (templates.has('tags')) output['tags/index.html'] = renderTemplate(templates.get('tags'), scope);

  for (const { path, content } of statics) {
    if (Object.hasOwn(output, path)) report.push('shadowed ' + path + ': a built page has its path');
    else output[path] = content;
  }
  for (const line of broken) report.push(line);
  report.sort();
  report.push('built ' + (sources.length - posts.length) + ' pages, ' + posts.length +
    ' posts, ' + tags.length + ' tags and ' + statics.length + ' static files');
  output['build-report.txt'] = report.join('\n') + '\n';
  return output;
}
