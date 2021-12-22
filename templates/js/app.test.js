import request from "supertest";

import app from "./app.js";

describe("GET /users", function () {
  test("gives us back 200, with a message", async function () {
    const expectedBody = {
      message: "I wish we had some information to give you ☹️"
    };
    const actual = await request(app).get("/users");
    expect(actual.body).toStrictEqual(expectedBody);
    expect(actual.statusCode).toBe(200);
  });
});
