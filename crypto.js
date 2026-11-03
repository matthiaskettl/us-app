const bytesToBase64=bytes=>btoa(String.fromCharCode(...bytes));
const base64ToBytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function derive(passphrase,salt) {
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptSecret(data,passphrase,id) {
  if(passphrase.length<12) throw new Error('Use a vault passphrase of at least 12 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await derive(passphrase,salt);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)},key,new TextEncoder().encode(JSON.stringify(data)));
  return {v:1,iterations:600000,salt:bytesToBase64(salt),iv:bytesToBase64(iv),cipher:bytesToBase64(new Uint8Array(cipher))};
}
export async function decryptSecret(encrypted,passphrase,id) {
  if(encrypted.v!==1 || encrypted.iterations!==600000) throw new Error('Unsupported vault format.');
  try {
    const key=await derive(passphrase,base64ToBytes(encrypted.salt));
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(encrypted.iv),additionalData:new TextEncoder().encode(id)},key,base64ToBytes(encrypted.cipher));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {throw new Error('Could not unlock this key. Check your vault passphrase.');}
}
