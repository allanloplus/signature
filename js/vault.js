/* 簽名保險箱：PBKDF2-SHA256 (600k) + AES-256-GCM，全程在瀏覽器內完成 */
'use strict';
const Vault = (() => {
  const ITER = 600000, LS_KEY = 'allan.vault.v1', PATH = 'vault/allan.vault.json';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(payload, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, ITER);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
    return { format: 'allan-sign-vault', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function open(vault, pass) {
    if (!vault || vault.format !== 'allan-sign-vault' || vault.iter < 100000) throw new Error('保險箱格式不正確');
    const key = await deriveKey(pass, unb64(vault.salt), vault.iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.ct)); // 密語錯誤會丟例外
    return JSON.parse(dec.decode(pt));
  }
  /* 尋找保險箱：此裝置 localStorage（僅密文）→ 網站上的 vault 檔 */
  async function locate() {
    try { const s = localStorage.getItem(LS_KEY); if (s) return { vault: JSON.parse(s), from: 'device' }; } catch (e) {}
    try { const r = await fetch(PATH, { cache: 'no-store' }); if (r.ok) return { vault: await r.json(), from: 'site' }; } catch (e) {}
    return null;
  }
  const remember = v => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const forget = () => { try { localStorage.removeItem(LS_KEY); } catch (e) {} };
  return { seal, open, locate, remember, forget };
})();
