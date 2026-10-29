const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { app, initRuntime } = require("../server");

const TEST_JWT_SECRET = "test-only-jwt-secret";

function createSupabaseMock() {
  const calls = [];
  const supabase = {
    from(table) {
      const state = {
        table,
        action: "select",
        columns: undefined,
        values: undefined,
        filters: [],
      };

      const execute = () => {
        const call = {
          table: state.table,
          action: state.action,
          columns: state.columns,
          values: state.values,
          filters: state.filters.slice(),
        };
        calls.push(call);
        return { data: [], error: null };
      };

      const builder = {
        select(columns) {
          state.columns = columns;
          if (state.action !== "update") state.action = "select";
          return builder;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return builder;
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve(execute()).then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return { supabase, calls };
}

function useMock() {
  const mock = createSupabaseMock();
  initRuntime({
    supabase: mock.supabase,
    jwtSecret: TEST_JWT_SECRET,
    resend: {
      emails: {
        send: async () => {
          throw new Error("Resend must not be called in urlencoded tests");
        },
      },
    },
  });
  return mock.calls;
}

function requestUrlencoded(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body;
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(payload),
      };

      const req = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
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
      req.write(payload);
      req.end();
    });
    server.on("error", reject);
  });
}

describe("express.urlencoded extended scalar parsing", { concurrency: false }, () => {
  test("URL-encoded POST /api/login parses ordinary scalar fields", async () => {
    const calls = useMock();
    const response = await requestUrlencoded(
      "POST",
      "/api/login",
      "email=user%40example.com&password=secret"
    );

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "User not found" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "Email");
    assert.equal(calls[0].action, "select");
    assert.deepEqual(calls[0].filters, [["email", "user@example.com"]]);
  });
});
