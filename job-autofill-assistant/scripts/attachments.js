// IndexedDB 仅在 background 访问；使用不可变 ID，失败时原引用仍然有效。
const attachmentStore = {
  async run(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('capybara-attachments', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('files', mode);
        const request = operation(transaction.objectStore('files'));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('附件存储失败'));
      });
    } finally { db.close(); }
  },
  get(id) { return this.run('readonly', store => store.get(id)); },
  put(file) { return this.run('readwrite', store => store.put(file)); },
  remove(id) { return this.run('readwrite', store => store.delete(id)); },
  all() { return this.run('readonly', store => store.getAll()); },
  decode(file) {
    if (!file || typeof file.name !== 'string' || !file.name.trim() || typeof file.dataUrl !== 'string') throw new Error('附件格式不正确');
    const match = file.dataUrl.match(/^data:([^;,]*);base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match || match[2].length % 4) throw new Error('附件内容不是有效的 base64');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    if (file.size != null && file.size !== bytes.length) throw new Error('附件大小核对失败');
    return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
  },
  async encode(file) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { id: file.id, name: file.name, type: file.blob.type, size: file.blob.size, dataUrl: `data:${file.blob.type};base64,${btoa(binary)}` };
  }
};
