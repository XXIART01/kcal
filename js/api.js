// Слой данных: JSON-файлы в приватном репозитории kcal-data через GitHub Contents API.
// Каждое сохранение = отдельный коммит; конфликты ловим по sha и повторяем на свежих данных.
const Store = (() => {
  const REPO = "XXIART01/kcal-data", KEY = "kcal_token";
  const url = p => `https://api.github.com/repos/${REPO}/contents/${p}`;
  const hdr = () => ({Authorization: "Bearer " + localStorage.getItem(KEY), Accept: "application/vnd.github+json"});
  const b64 = {
    enc: s => btoa(String.fromCharCode(...new TextEncoder().encode(s))),
    dec: s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0))),
  };
  const err = (code, msg) => Object.assign(new Error(msg), {code});

  // -> {data, sha} | null (файла нет)
  async function read(path){
    const r = await fetch(url(path) + "?t=" + Date.now(), {headers: hdr(), cache: "no-store"});
    if (r.status === 404) return null;
    if (!r.ok) throw err(r.status, "GitHub " + r.status);
    const j = await r.json();
    return {data: JSON.parse(b64.dec(j.content)), sha: j.sha};
  }

  // fn(текущие данные | null) -> новые данные. При конфликте sha (409/422) читаем заново и повторяем.
  async function update(path, fn, msg){
    for (let i = 0; i < 4; i++){
      const cur = await read(path);
      const data = fn(cur ? cur.data : null);
      const body = {message: msg, content: b64.enc(JSON.stringify(data, null, 2) + "\n")};
      if (cur) body.sha = cur.sha;
      const r = await fetch(url(path), {method: "PUT", headers: {...hdr(), "Content-Type": "application/json"}, body: JSON.stringify(body)});
      if (r.ok) return data;
      if (r.status !== 409 && r.status !== 422) throw err(r.status, "GitHub " + r.status);
    }
    throw err(409, "конфликт версий");
  }

  return {
    read, update,
    hasToken: () => !!localStorage.getItem(KEY),
    setToken: t => localStorage.setItem(KEY, t.trim()),
    clearToken: () => localStorage.removeItem(KEY),
    // проверка токена: доступ к репозиторию на запись
    async check(){
      const r = await fetch(`https://api.github.com/repos/${REPO}`, {headers: hdr()});
      if (!r.ok) throw err(r.status, "GitHub " + r.status);
      if (!(await r.json()).permissions?.push) throw err(403, "у токена нет права записи (Contents: Read and write)");
    },
  };
})();
