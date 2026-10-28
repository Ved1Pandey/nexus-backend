const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const pdfParse = require("pdf-parse");
const { app, initRuntime } = require("../server");

const TEST_JWT_SECRET = "test-only-jwt-secret";
const USER_ID = 99;
const OWNER_EMAIL = "owner@example.com";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const PDF_FIXTURE = path.join(__dirname, "fixtures", "valid-resume.pdf");
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

function signUser() {
  return jwt.sign(
    { id: USER_ID, name: "Test User", role: "Employee" },
    TEST_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function listUploadNames() {
  if (!fs.existsSync(UPLOADS_DIR)) return [];
  return fs.readdirSync(UPLOADS_DIR);
}

function buildMultipart(fieldName, filename, contentType, fileBuffer) {
  const boundary = "----NexusUploadTestBoundary";
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([header, fileBuffer, footer]),
  };
}

function createSupabaseMock() {
  const storageUploads = [];
  const supabase = {
    from(table) {
      const state = {
        table,
        action: "select",
        columns: undefined,
        values: undefined,
        filters: [],
      };

      const snapshot = () => ({
        table: state.table,
        action: state.action,
        columns: state.columns,
        values: state.values,
        filters: state.filters.slice(),
      });

      const execute = () => {
        const call = snapshot();
        if (call.table === "Email" && call.action === "select") {
          return { data: { email: OWNER_EMAIL }, error: null };
        }
        if (call.table === "candidates" && call.action === "upsert") {
          return { data: [{ id: "cand-1", email: OWNER_EMAIL }], error: null };
        }
        return { data: null, error: null };
      };

      const builder = {
        select(columns) {
          state.columns = columns;
          if (state.action !== "upsert") state.action = "select";
          return builder;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return builder;
        },
        upsert(values) {
          state.action = "upsert";
          state.values = values;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(execute());
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(execute()).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
    storage: {
      from(bucket) {
        return {
          async upload(objectPath, fileBuffer, options) {
            storageUploads.push({
              bucket,
              objectPath,
              byteLength: Buffer.isBuffer(fileBuffer)
                ? fileBuffer.length
                : Buffer.byteLength(fileBuffer),
              contentType: options && options.contentType,
            });
            return { data: { path: objectPath }, error: null };
          },
        };
      },
    },
  };

  return { supabase, storageUploads };
}

function useMocks() {
  const mock = createSupabaseMock();
  initRuntime({
    supabase: mock.supabase,
    jwtSecret: TEST_JWT_SECRET,
    resend: {
      emails: {
        send: async () => {
          throw new Error("Resend must not be called in upload tests");
        },
      },
    },
  });
  return mock;
}

function requestMultipart({ token, filename, contentType, fileBuffer }) {
  const multipart = buildMultipart("resume", filename, contentType, fileBuffer);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const headers = {
        "Content-Type": multipart.contentType,
        "Content-Length": multipart.body.length,
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/upload-resume",
          method: "POST",
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close(() => {
              const text = Buffer.concat(chunks).toString("utf8");
              let parsed = text;
              try {
                parsed = JSON.parse(text);
              } catch {
                parsed = text;
              }
              resolve({ status: res.statusCode, body: parsed });
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close(() => reject(err));
      });
      req.write(multipart.body);
      req.end();
    });
    server.on("error", reject);
  });
}

describe("POST /api/upload-resume", { concurrency: false }, () => {
  let pdfBuffer;
  let token;

  before(async () => {
    pdfBuffer = fs.readFileSync(PDF_FIXTURE);
    const parsed = await pdfParse(pdfBuffer);
    assert.ok(parsed && typeof parsed.text === "string" && parsed.text.length > 0);
    token = signUser();
  });

  test("authenticated user uploading a valid PDF returns 200 and uploads once", async () => {
    const mock = useMocks();
    const beforeFiles = new Set(listUploadNames());

    const response = await requestMultipart({
      token,
      filename: "resume.pdf",
      contentType: "application/pdf",
      fileBuffer: pdfBuffer,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.candidateId, "cand-1");
    assert.equal(typeof response.body.path, "string");
    assert.match(response.body.path, new RegExp(`^${USER_ID}/\\d+-resume\\.pdf$`));
    assert.equal(response.body.publicUrl, response.body.path);
    assert.equal(typeof response.body.text, "string");
    assert.ok(response.body.text.length > 0);
    assert.equal(mock.storageUploads.length, 1);
    assert.equal(mock.storageUploads[0].bucket, "resumes");
    assert.equal(mock.storageUploads[0].objectPath, response.body.path);
    assert.equal(mock.storageUploads[0].contentType, "application/pdf");

    const afterFiles = listUploadNames();
    for (const name of afterFiles) {
      assert.equal(beforeFiles.has(name), true);
    }
  });

  test("non-PDF upload returns 400 and does not call storage", async () => {
    const mock = useMocks();
    const beforeFiles = new Set(listUploadNames());

    const response = await requestMultipart({
      token,
      filename: "notes.txt",
      contentType: "text/plain",
      fileBuffer: Buffer.from("not a pdf"),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "Only PDF files are allowed" });
    assert.equal(mock.storageUploads.length, 0);

    const afterFiles = listUploadNames();
    for (const name of afterFiles) {
      assert.equal(beforeFiles.has(name), true);
    }
  });

  test("upload over 5 MB returns 400 and does not call storage", async () => {
    const mock = useMocks();
    const beforeFiles = new Set(listUploadNames());
    const oversized = Buffer.concat([
      pdfBuffer,
      Buffer.alloc(MAX_RESUME_BYTES + 1 - pdfBuffer.length, 0x20),
    ]);

    const response = await requestMultipart({
      token,
      filename: "resume.pdf",
      contentType: "application/pdf",
      fileBuffer: oversized,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "File too large" });
    assert.equal(mock.storageUploads.length, 0);

    const afterFiles = listUploadNames();
    for (const name of afterFiles) {
      assert.equal(beforeFiles.has(name), true);
    }
  });
});
