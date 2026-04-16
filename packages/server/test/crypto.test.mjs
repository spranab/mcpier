import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "../dist/crypto.js";

const MASTER = "0".repeat(64);

test("encrypt → decrypt round-trip recovers the plaintext", () => {
  const plain = "sk-super-secret-key-with-émoji-🔑";
  const cipher = encrypt(MASTER, plain);
  assert.notEqual(cipher, plain);
  assert.equal(decrypt(MASTER, cipher), plain);
});

test("encrypt produces different ciphertext each call (random IV)", () => {
  const a = encrypt(MASTER, "same-plaintext");
  const b = encrypt(MASTER, "same-plaintext");
  assert.notEqual(a, b);
  assert.equal(decrypt(MASTER, a), decrypt(MASTER, b));
});

test("decrypt with wrong master key fails", () => {
  const cipher = encrypt(MASTER, "secret");
  const wrong = "1".repeat(64);
  assert.throws(() => decrypt(wrong, cipher));
});

test("decrypt of tampered ciphertext fails (GCM auth)", () => {
  const cipher = encrypt(MASTER, "secret");
  const bytes = Buffer.from(cipher, "base64");
  bytes[bytes.length - 1] ^= 0xff;
  const tampered = bytes.toString("base64");
  assert.throws(() => decrypt(MASTER, tampered));
});

test("empty plaintext round-trips", () => {
  assert.equal(decrypt(MASTER, encrypt(MASTER, "")), "");
});
