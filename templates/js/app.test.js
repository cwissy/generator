import request from "supertest";

import app from "./app.js";

describe("GET /users", function () {
  test("gives us back 200", function () {
    await request(app).get("/users").expect(200, {
      message: "I wish we had some information to give you ☹️"
    });
  });
});
