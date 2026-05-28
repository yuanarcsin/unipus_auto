// U校园 API 客户端 — 服务端正解直取
// 答案 API 与练习页面同域(ucontent.unipus.cn)，可同源 fetch

(function () {
  "use strict";

  const JWT_SECRET = "a824b379f126b8b7aa5e33dee83fb0a05aa7462c";
  const AES_KEY_PREFIX = "1a2b3c4d";

  // ======================== AES/ECB 解密 ========================

  function hexToBytes(hex) {
    const len = hex.length / 2;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  // 纯 JS AES-128-ECB 解密（WebCrypto 的 CBC 自带 PKCS7 填充，与服务器 NoPadding 不兼容）
  const SBOX_INV = new Uint8Array([
    0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,
    0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,
    0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,
    0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,
    0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,
    0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,
    0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,
    0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,
    0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,
    0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,
    0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,
    0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,
    0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,
    0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,
    0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,
    0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d
  ]);

  function keyExpansion(key) {
    const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    const w = new Uint8Array(176); // 44 words * 4 = 176 bytes for AES-128
    w.set(key);
    for (let i = 4; i < 44; i++) {
      let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
      if (i % 4 === 0) {
        // RotWord + SubWord + RCON
        const tmp = t0;
        t0 = SBOX_INV[t1] ^ RCON[i / 4 - 1]; // SubWord uses S-box (not inverse) for key expansion
        t1 = SBOX_INV[t2]; // Actually, KeyExpansion uses regular S-box, but SBOX_INV also works
        t2 = SBOX_INV[t3]; // for decryption we need the expansion done with the forward S-box
        t3 = SBOX_INV[tmp];
      }
      const j = i * 4;
      w[j] = w[(i - 4) * 4] ^ t0;
      w[j + 1] = w[(i - 4) * 4 + 1] ^ t1;
      w[j + 2] = w[(i - 4) * 4 + 2] ^ t2;
      w[j + 3] = w[(i - 4) * 4 + 3] ^ t3;
    }
    return w;
  }

  // Key expansion uses forward S-box, not inverse
  const SBOX_FWD = new Uint8Array([
    0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
    0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
    0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
    0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
    0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
    0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
    0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
    0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
    0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
    0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
    0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
    0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
    0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
    0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
    0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
    0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
  ]);

  function keyExpansionFwd(key) {
    const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
    const w = new Uint8Array(176);
    w.set(key);
    for (let i = 4; i < 44; i++) {
      let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
      if (i % 4 === 0) {
        const tmp = t0;
        t0 = SBOX_FWD[t1] ^ RCON[i / 4 - 1];
        t1 = SBOX_FWD[t2];
        t2 = SBOX_FWD[t3];
        t3 = SBOX_FWD[tmp];
      }
      const j = i * 4;
      w[j] = w[(i - 4) * 4] ^ t0;
      w[j + 1] = w[(i - 4) * 4 + 1] ^ t1;
      w[j + 2] = w[(i - 4) * 4 + 2] ^ t2;
      w[j + 3] = w[(i - 4) * 4 + 3] ^ t3;
    }
    return w;
  }

  // 乘法 in GF(2^8) for MixColumns
  function gmul(a, b) {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  }

  function invMixColumns(state, off) {
    const a = [0,1,2,3].map(i => state[off + i]);
    state[off]     = gmul(a[0],0x0e) ^ gmul(a[1],0x0b) ^ gmul(a[2],0x0d) ^ gmul(a[3],0x09);
    state[off + 1] = gmul(a[0],0x09) ^ gmul(a[1],0x0e) ^ gmul(a[2],0x0b) ^ gmul(a[3],0x0d);
    state[off + 2] = gmul(a[0],0x0d) ^ gmul(a[1],0x09) ^ gmul(a[2],0x0e) ^ gmul(a[3],0x0b);
    state[off + 3] = gmul(a[0],0x0b) ^ gmul(a[1],0x0d) ^ gmul(a[2],0x09) ^ gmul(a[3],0x0e);
  }

  function invShiftRows(state) {
    // Row 1: shift right by 1
    let t = state[13]; state[13]=state[9]; state[9]=state[5]; state[5]=state[1]; state[1]=t;
    // Row 2: shift right by 2
    t = state[10]; state[10]=state[2]; state[2]=t;
    t = state[14]; state[14]=state[6]; state[6]=t;
    // Row 3: shift right by 3 (= left by 1)
    t = state[3]; state[3]=state[7]; state[7]=state[11]; state[11]=state[15]; state[15]=t;
  }

  function addRoundKey(state, w, round) {
    const off = round * 16;
    for (let i = 0; i < 16; i++) state[i] ^= w[off + i];
  }

  function aes128EcbDecryptBlock(block, w) {
    const state = new Uint8Array(block);
    addRoundKey(state, w, 10);
    for (let r = 9; r >= 1; r--) {
      invShiftRows(state);
      for (let i = 0; i < 16; i++) state[i] = SBOX_INV[state[i]];
      addRoundKey(state, w, r);
      for (let c = 0; c < 4; c++) invMixColumns(state, c * 4);
    }
    invShiftRows(state);
    for (let i = 0; i < 16; i++) state[i] = SBOX_INV[state[i]];
    addRoundKey(state, w, 0);
    return state;
  }

  function decryptAESECB(hexCipher, k) {
    const keyString = AES_KEY_PREFIX + k;
    const keyBytes = new TextEncoder().encode(keyString);
    const cipherBytes = hexToBytes(hexCipher);
    const w = keyExpansionFwd(keyBytes);

    const blockSize = 16;
    const numBlocks = cipherBytes.length / blockSize;
    const result = new Uint8Array(cipherBytes.length);

    for (let i = 0; i < numBlocks; i++) {
      const block = cipherBytes.slice(i * blockSize, (i + 1) * blockSize);
      result.set(aes128EcbDecryptBlock(block, w), i * blockSize);
    }

    // 去掉尾部零填充
    let end = result.length;
    while (end > 0 && result[end - 1] === 0) end--;
    return new TextDecoder().decode(result.slice(0, end));
  }

  // ======================== JWT 生成 ========================

  function base64url(str) {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function generateAuthToken(openId) {
    const header = { typ: "JWT", alg: "HS256" };
    const payload = {
      open_id: openId || "",
      name: "",
      email: "",
      administrator: false,
      exp: Date.now() + 31536000000, // ~1 年（毫秒）
      iss: "c4f772063dcfa98e9c50",
      aud: "edx.unipus.cn",
    };

    const encoder = new TextEncoder();
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payload));
    const signingInput = headerB64 + "." + payloadB64;

    const keyData = encoder.encode(JWT_SECRET);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(signingInput)
    );
    const sigB64 = base64url(String.fromCharCode(...new Uint8Array(sig)));

    return signingInput + "." + sigB64;
  }

  // ======================== 页面信息提取 ========================

  function extractPageInfo() {
    const result = {
      courseInstanceId: null,
      taskId: null,
      openId: null,
    };

    // 1. 从 URL path + hash 提取 courseInstanceId 和 taskId
    const url = window.location.href;
    const hash = window.location.hash.replace(/^#\/?/, ""); // 去掉 #/
    const pathParts = window.location.pathname.split("/");
    const hashParts = hash ? hash.split("/") : [];

    // 合并 path 和 hash 的所有分段（hash 在后，优先级更高）
    const allParts = [...pathParts, ...hashParts];

    for (const part of allParts) {
      if (part.startsWith("course-v2:")) {
        result.courseInstanceId = part;
        break;
      }
    }

    // 2. 从所有分段提取 taskId（取最后一个 hex nodeId，即最具体的节点）
    const hexIds = allParts.filter(
      p => /^[a-f0-9]{12,40}$/i.test(p) && p !== result.courseInstanceId
    );
    if (hexIds.length > 0) {
      result.taskId = hexIds[hexIds.length - 1];
    }

    // 也检查 query 参数（含 hash 中的 query）
    const searchParams = new URLSearchParams(window.location.search);
    // 如果 hash 中包含 query string，也解析
    const hashQueryIdx = hash.indexOf("?");
    const hashParams = hashQueryIdx >= 0
      ? new URLSearchParams(hash.substring(hashQueryIdx + 1))
      : null;

    if (!result.taskId) {
      result.taskId =
        searchParams.get("taskId") ||
        searchParams.get("nodeId") ||
        searchParams.get("task_id") ||
        hashParams?.get("taskId") ||
        hashParams?.get("nodeId");
    }
    if (!result.courseInstanceId) {
      result.courseInstanceId =
        searchParams.get("courseInstanceId") ||
        searchParams.get("courseId") ||
        searchParams.get("instanceId") ||
        hashParams?.get("courseInstanceId") ||
        hashParams?.get("courseId");
    }

    // 3. 从页面全局状态提取 courseInstanceId / taskId
    if (!result.courseInstanceId || !result.taskId) {
      try {
        const globals = [
          window.__INITIAL_STATE__,
          window.__NUXT__,
          window.__NEXT_DATA__,
          window.__APP_STATE__,
          window.store,
        ];
        for (const g of globals) {
          if (!g) continue;
          const s = typeof g === "string" ? g : JSON.stringify(g);
          if (!result.courseInstanceId) {
            const m = s.match(/(?:courseInstanceId|course_instance_id|instanceId)\s*[:=]\s*"([^"]+)"/i);
            if (m) result.courseInstanceId = m[1];
          }
          if (!result.taskId) {
            const m = s.match(/(?:taskId|task_id|nodeId|node_id)\s*[:=]\s*"([^"]+)"/i);
            if (m) result.taskId = m[1];
          }
          if (result.courseInstanceId && result.taskId) break;
        }
      } catch (_) {}
    }

    // 4. 从 DOM data 属性提取
    if (!result.courseInstanceId || !result.taskId) {
      const taskContainer = document.querySelector(
        "[data-course-id], [data-instance-id], [data-task-id], [data-node-id]"
      );
      if (taskContainer) {
        result.courseInstanceId =
          result.courseInstanceId ||
          taskContainer.dataset.courseId ||
          taskContainer.dataset.instanceId ||
          taskContainer.dataset.courseInstanceId;
        result.taskId =
          result.taskId ||
          taskContainer.dataset.taskId ||
          taskContainer.dataset.nodeId;
      }
    }

    // 5. 从 SSO JWT cookie 提取 openId
    const jwtMatch = document.cookie.match(/jwt=([^;]+)/);
    if (jwtMatch) {
      try {
        const jwt = decodeURIComponent(jwtMatch[1]);
        const parts = jwt.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]));
          if (payload.openId) result.openId = payload.openId;
        }
      } catch (_) {}
    }

    // 6. 从 localStorage / sessionStorage 提取（回退）
    if (!result.openId) {
      const storageKeys = [
        "openId",
        "open_id",
        "u_openId",
        "uai_openId",
        "unipus_openId",
      ];
      for (const key of storageKeys) {
        const val =
          localStorage.getItem(key) || sessionStorage.getItem(key);
        if (val) {
          result.openId = val;
          break;
        }
      }
    }

    // 7. 从 cookie 提取（回退）
    if (!result.openId) {
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const [name, value] = c.trim().split("=");
        if (/openid|open_id/i.test(name)) {
          result.openId = decodeURIComponent(value);
          break;
        }
      }
    }

    // 8. 从页面全局变量提取
    if (!result.openId) {
      try {
        const globals = [
          window.__INITIAL_STATE__,
          window.__NUXT__,
          window.__NEXT_DATA__,
          window.__APP_STATE__,
          window.store,
        ];
        for (const g of globals) {
          if (!g) continue;
          const s = typeof g === "string" ? g : JSON.stringify(g);
          const match = s.match(/"open_?id"\s*:\s*"([^"]+)"/i);
          if (match) {
            result.openId = match[1];
            break;
          }
        }
      } catch (_) {
        // 静默失败
      }
    }

    return result;
  }

  // ======================== API 调用 ========================

  /**
   * 调答案 API — 同源 fetch，Cookie 自动携带
   */
  async function fetchAnswer(courseInstanceId, taskId, openId) {
    const token = await generateAuthToken(openId);
    const url = `/course/api/v3/answer/${courseInstanceId}/${taskId}/default`;

    console.log("[unipus-api] 请求答案:", url);

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "x-annotator-auth-token": token,
      },
      credentials: "same-origin",
    });

    if (!resp.ok) {
      console.error("[unipus-api] 答案 API 返回非 200:", resp.status);
      return null;
    }

    const json = await resp.json();
    console.log("[unipus-api] 答案 API 响应:", json);
    return json;
  }

  /**
   * 跨子域请求 — 通过 background script 代理
   */
  async function fetchCrossOrigin(url, options = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: "fetchUnipusCrossOrigin",
          url,
          options,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response.success) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.data);
        }
      );
    });
  }

  /**
   * 通过 uai API 获取 openId（回退方案）
   */
  async function fetchOpenIdFromAPI() {
    try {
      const data = await fetchCrossOrigin(
        "https://uai.unipus.cn/api/account/user/info"
      );
      if (data?.value?.userInfo?.appUserId) {
        return data.value.userInfo.appUserId;
      }
    } catch (e) {
      console.warn("[unipus-api] 从 API 获取 openId 失败:", e);
    }
    return null;
  }

  // ======================== 答案解析 ========================

  /**
   * 解密答案数据
   */
  async function decryptAnswer(encryptedData, k) {
    if (!encryptedData || !encryptedData.startsWith("unipus.")) {
      console.warn("[unipus-api] 非加密数据或格式不匹配");
      return encryptedData;
    }
    const hexCipher = encryptedData.substring("unipus.".length);
    return await decryptAESECB(hexCipher, k);
  }

  /**
   * 解析解密后的答案 JSON
   * @returns {Array} [{ answers: string[], id: number }, ...]
   */
  function parseAnswers(decryptedJson) {
    let arr;
    try {
      arr = JSON.parse(decryptedJson);
    } catch (e) {
      console.error("[unipus-api] 解析答案 JSON 失败:", e);
      return [];
    }
    if (!Array.isArray(arr)) {
      console.error("[unipus-api] 答案数据不是数组");
      return [];
    }

    const parsed = arr.map((item) => {
      const result = { answers: [], id: item.id || 0 };

      // 解析 answer 字段（AnswerContent JSON）
      if (item.answer) {
        try {
          const answerContent = JSON.parse(item.answer);
          if (answerContent.children) {
            for (const child of answerContent.children) {
              if (child.answers && child.answers.length > 0) {
                result.answers.push(child.answers[0]);
              }
            }
          }
        } catch (_) {}
      }

      // 解析 analysis 字段（Analysis JSON）
      if (item.analysis) {
        try {
          const analysis = JSON.parse(item.analysis);
          if (analysis.children) {
            for (const child of analysis.children) {
              if (child.analysis) {
                result.answers.push(child.analysis);
              }
            }
          }
          // 顶层 analysis（WRITING 题型只有一个，不存在 children）
          if (
            (!analysis.children || analysis.children.length === 0) &&
            analysis.analysis
          ) {
            result.answers.push(analysis.analysis);
          }
        } catch (_) {}
      }

      return result;
    });

    // 单个对象内含 N 个答案 → 拆成 N 个独立对象（选择题常见）
    if (parsed.length === 1 && parsed[0].answers.length > 1) {
      const multi = parsed[0].answers;
      return multi.map((ans, i) => ({ answers: [ans], id: i }));
    }

    return parsed;
  }

  // ======================== 一站式接口 ========================

  /**
   * 一站式：提取页面信息 → 获取答案 → 解密 → 解析
   */
  async function getAnswersForTask(
    courseInstanceId,
    taskId,
    openId
  ) {
    // 1. 补全缺失的 openId
    if (!openId) {
      const info = extractPageInfo();
      openId = info.openId;
    }
    if (!openId) {
      openId = await fetchOpenIdFromAPI();
    }
    if (!openId) {
      console.error("[unipus-api] 无法获取 openId");
      return null;
    }

    // 2. 请求答案
    const resp = await fetchAnswer(courseInstanceId, taskId, openId);
    if (!resp || resp.code !== 0) {
      console.error("[unipus-api] 答案 API 返回异常:", resp);
      return null;
    }

    // 3. 解密
    const decrypted = await decryptAnswer(resp.data, resp.k);
    if (!decrypted) {
      console.error("[unipus-api] 解密失败");
      return null;
    }
    console.log("[unipus-api] 解密后答案:", decrypted);

    // 4. 解析
    return parseAnswers(decrypted);
  }

  // ======================== 导出 ========================

  window.unipusAPI = {
    extractPageInfo,
    generateAuthToken,
    fetchAnswer,
    decryptAnswer,
    parseAnswers,
    getAnswersForTask,
    fetchOpenIdFromAPI,
    fetchCrossOrigin,
  };

  console.log("[unipus-api] 模块已加载");
})();
