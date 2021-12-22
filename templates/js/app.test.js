import request from "supertest";

import app from "./app.js";

describe("GET /users", function () {
  test("gives us back 200, with a message", async function () {
    const expected = {
      message: "I wish we had some information to give you ☹️"
    };
    const response = await request(app).get("/users").expect(200);
    const actual = response.body;
    expect(actual).toStrictEqual(expected);
  });
});
