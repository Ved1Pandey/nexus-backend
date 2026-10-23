const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const jwt = require("jsonwebtoken");
const { app, initRuntime } = require("../server");

const TEST_JWT_SECRET = "test-only-jwt-secret";
const LEAD_ID = 42;
const REPORT_ID = 7;
const OUTSIDER_ID = 8;

function signUser(role, id) {
  return jwt.sign(
    { id, name: "Test User", role },
    TEST_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function createSupabaseMock(respond) {
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
        return respond(call);
      };

      const builder = {
        select(columns) {
          state.columns = columns;
          if (state.action !== "update") state.action = "select";
          return builder;
        },
        update(values) {
          state.action = "update";
          state.values = values;
          return builder;
        },
        eq(column, value) {
          state.filters.push([column, value]);
          return builder;
        },
        single() {
          return Promise.resolve(execute());
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
  };

  return { supabase, calls };
}

function useMock(respond) {
  const mock = createSupabaseMock(respond);
  initRuntime({
    supabase: mock.supabase,
    jwtSecret: TEST_JWT_SECRET,
    resend: {
      emails: {
        send: async () => {
          throw new Error("Resend must not be called in authorization tests");
        },
      },
    },
  });
  return mock.calls;
}

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body === undefined ? null : JSON.stringify(body);
      const headers = {};
      if (payload !== null) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }
      if (token) headers.Authorization = `Bearer ${token}`;

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
      if (payload !== null) req.write(payload);
      req.end();
    });
    server.on("error", reject);
  });
}

function assertNoWrites(calls) {
  assert.equal(
    calls.some((call) => call.action === "update"),
    false
  );
  assert.equal(
    calls.some(
      (call) =>
        call.table === "employees" && call.columns === "cl, sl, pl"
    ),
    false
  );
}

const leadToken = signUser("Team Lead", LEAD_ID);

describe("Team Lead approval scope", { concurrency: false }, () => {
  test("leave outside the team returns 404 and does not update or deduct balance", async () => {
    const calls = useMock((call) => {
      if (call.table === "leaves" && call.action === "select") {
        return {
          data: {
            id: "101",
            employee_id: OUTSIDER_ID,
            status: "PENDING",
            type: "CL",
            from_date: "2026-01-10",
            to_date: "2026-01-10",
          },
          error: null,
        };
      }
      if (call.table === "employees" && call.action === "select") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/leaves/101", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Leave not found" });
    assert.deepEqual(
      calls.map((call) => [call.table, call.action]),
      [
        ["leaves", "select"],
        ["employees", "select"],
      ]
    );
    assert.deepEqual(calls[1].filters, [
      ["id", OUTSIDER_ID],
      ["manager_id", LEAD_ID],
    ]);
    assertNoWrites(calls);
  });

  test("leave for a direct report keeps the approved update and balance deduction", async () => {
    const calls = useMock((call) => {
      if (call.table === "leaves" && call.action === "select") {
        return {
          data: {
            id: "101",
            employee_id: REPORT_ID,
            status: "PENDING",
            type: "CL",
            from_date: "2026-01-10",
            to_date: "2026-01-10",
          },
          error: null,
        };
      }
      if (call.table === "employees" && call.columns === "id") {
        return { data: { id: REPORT_ID }, error: null };
      }
      if (call.table === "employees" && call.columns === "cl, sl, pl") {
        return { data: { cl: 5, sl: 2, pl: 3 }, error: null };
      }
      if (call.table === "leaves" && call.action === "update") {
        return { data: [{ id: "101", status: "APPROVED" }], error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/leaves/101", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, [{ id: "101", status: "APPROVED" }]);
    assert.deepEqual(calls[1].filters, [
      ["id", REPORT_ID],
      ["manager_id", LEAD_ID],
    ]);
    assert.deepEqual(calls[3].values, { cl: 4 });
    assert.deepEqual(calls[3].filters, [["id", REPORT_ID]]);
    assert.deepEqual(calls[4].values, { status: "APPROVED" });
    assert.deepEqual(calls[4].filters, [["id", "101"]]);
  });

  test("missing leave returns 404 before any update", async () => {
    const calls = useMock(() => ({ data: null, error: null }));

    const response = await request("PUT", "/api/leaves/404", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Leave not found" });
    assert.deepEqual(
      calls.map((call) => [call.table, call.action]),
      [["leaves", "select"]]
    );
    assertNoWrites(calls);
  });

  test("work request outside the team returns 404 and does not update", async () => {
    const calls = useMock((call) => {
      if (call.table === "work_requests" && call.action === "select") {
        return {
          data: { id: "wr-1", employee_id: OUTSIDER_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/work-request/wr-1", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Work request not found" });
    assert.deepEqual(calls[1].filters, [
      ["id", OUTSIDER_ID],
      ["manager_id", LEAD_ID],
    ]);
    assertNoWrites(calls);
  });

  test("work request for a direct report keeps the approval update", async () => {
    const calls = useMock((call) => {
      if (call.table === "work_requests" && call.action === "select") {
        return {
          data: { id: "wr-1", employee_id: REPORT_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: { id: REPORT_ID }, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/work-request/wr-1", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true });
    assert.deepEqual(calls[1].filters, [
      ["id", REPORT_ID],
      ["manager_id", LEAD_ID],
    ]);
    assert.equal(calls[2].table, "work_requests");
    assert.equal(calls[2].action, "update");
    assert.equal(calls[2].values.status, "APPROVED");
    assert.equal(calls[2].values.approved_by, LEAD_ID);
    assert.equal(typeof calls[2].values.approved_at, "string");
    assert.deepEqual(calls[2].filters, [["id", "wr-1"]]);
  });

  test("missing work request returns 404 before any update", async () => {
    const calls = useMock(() => ({
      data: null,
      error: { message: "missing" },
    }));

    const response = await request("PUT", "/api/work-request/missing", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Work request not found" });
    assert.deepEqual(
      calls.map((call) => [call.table, call.action]),
      [["work_requests", "select"]]
    );
    assertNoWrites(calls);
  });

  test("attendance regularization outside the team returns 404 and does not update", async () => {
    const calls = useMock((call) => {
      if (call.table === "attendance_regularization" && call.action === "select") {
        return {
          data: { id: "ar-1", employee_id: OUTSIDER_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/attendance-regularization/ar-1", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: "Attendance regularization not found",
    });
    assert.deepEqual(calls[1].filters, [
      ["id", OUTSIDER_ID],
      ["manager_id", LEAD_ID],
    ]);
    assertNoWrites(calls);
  });

  test("attendance regularization for a direct report keeps the approval update", async () => {
    const calls = useMock((call) => {
      if (call.table === "attendance_regularization" && call.action === "select") {
        return {
          data: { id: "ar-1", employee_id: REPORT_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: { id: REPORT_ID }, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/attendance-regularization/ar-1", {
      token: leadToken,
      body: { status: "APPROVED" },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { success: true });
    assert.deepEqual(calls[1].filters, [
      ["id", REPORT_ID],
      ["manager_id", LEAD_ID],
    ]);
    assert.equal(calls[2].table, "attendance_regularization");
    assert.equal(calls[2].action, "update");
    assert.equal(calls[2].values.status, "APPROVED");
    assert.equal(calls[2].values.approved_by, LEAD_ID);
    assert.equal(typeof calls[2].values.approved_at, "string");
    assert.deepEqual(calls[2].filters, [["id", "ar-1"]]);
  });

  test("missing attendance regularization returns 404 before any update", async () => {
    const calls = useMock(() => ({
      data: null,
      error: { message: "missing" },
    }));

    const response = await request(
      "PUT",
      "/api/attendance-regularization/missing",
      {
        token: leadToken,
        body: { status: "APPROVED" },
      }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: "Attendance regularization not found",
    });
    assert.deepEqual(
      calls.map((call) => [call.table, call.action]),
      [["attendance_regularization", "select"]]
    );
    assertNoWrites(calls);
  });

  test("leave outside the team cannot be rejected and does not write status or balance", async () => {
    const calls = useMock((call) => {
      if (call.table === "leaves" && call.action === "select") {
        return {
          data: {
            id: "102",
            employee_id: OUTSIDER_ID,
            status: "PENDING",
            type: "SL",
            from_date: "2026-02-01",
            to_date: "2026-02-01",
          },
          error: null,
        };
      }
      if (call.table === "employees" && call.action === "select") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/leaves/102", {
      token: leadToken,
      body: { status: "REJECTED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Leave not found" });
    assertNoWrites(calls);
  });

  test("work request outside the team cannot be rejected and does not write approval metadata", async () => {
    const calls = useMock((call) => {
      if (call.table === "work_requests" && call.action === "select") {
        return {
          data: { id: "wr-2", employee_id: OUTSIDER_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request("PUT", "/api/work-request/wr-2", {
      token: leadToken,
      body: { status: "REJECTED" },
    });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Work request not found" });
    assertNoWrites(calls);
    assert.equal(
      calls.some(
        (call) =>
          call.values &&
          (Object.prototype.hasOwnProperty.call(call.values, "status") ||
            Object.prototype.hasOwnProperty.call(call.values, "approved_by") ||
            Object.prototype.hasOwnProperty.call(call.values, "approved_at"))
      ),
      false
    );
  });

  test("attendance regularization outside the team cannot be rejected and does not write approval metadata", async () => {
    const calls = useMock((call) => {
      if (call.table === "attendance_regularization" && call.action === "select") {
        return {
          data: { id: "ar-2", employee_id: OUTSIDER_ID },
          error: null,
        };
      }
      if (call.table === "employees") {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    const response = await request(
      "PUT",
      "/api/attendance-regularization/ar-2",
      {
        token: leadToken,
        body: { status: "REJECTED" },
      }
    );

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: "Attendance regularization not found",
    });
    assertNoWrites(calls);
    assert.equal(
      calls.some(
        (call) =>
          call.values &&
          (Object.prototype.hasOwnProperty.call(call.values, "status") ||
            Object.prototype.hasOwnProperty.call(call.values, "approved_by") ||
            Object.prototype.hasOwnProperty.call(call.values, "approved_at"))
      ),
      false
    );
  });
});
