#!/usr/bin/env node

var ejs = require("ejs");
var fs = require("fs");
var minimatch = require("minimatch");
var mkdirp = require("mkdirp");
var path = require("path");
var program = require("commander");
var readline = require("readline");
var sortedObject = require("sorted-object");
var util = require("util");

var MODE_0666 = parseInt("0666", 8);
var MODE_0755 = parseInt("0755", 8);
var TEMPLATE_DIR = path.join(__dirname, "..", "templates");
var VERSION = require("../package").version;

var _exit = process.exit;

// Re-assign process.exit because of commander
// TODO: Switch to a different command framework
process.exit = exit;

// CLI

around(program, "optionMissingArgument", function (fn, args) {
  program.outputHelp();
  fn.apply(this, args);
  return { args: [], unknown: [] };
});

before(program, "outputHelp", function () {
  // track if help was shown for unknown option
  this._helpShown = true;
});

before(program, "unknownOption", function () {
  // allow unknown options if help was shown, to prevent trailing error
  this._allowUnknownOption = this._helpShown;

  // show help if not yet shown
  if (!this._helpShown) {
    program.outputHelp();
  }
});

program
  .name("express")
  .version(VERSION, "    --version")
  .usage("[options] [dir]")
  .option("    --git", "add .gitignore")
  .option("-p, --pg", "setup PostgreSQL database connection")
  .option("-d, --dev", "create a development mode")
  .option("-f, --force", "force on non-empty directory")
  .parse(process.argv);

if (!exit.exited) {
  main();
}

/**
 * Install an around function; AOP.
 */

function around(obj, method, fn) {
  var old = obj[method];

  obj[method] = function () {
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) args[i] = arguments[i];
    return fn.call(this, old, args);
  };
}

/**
 * Install a before function; AOP.
 */

function before(obj, method, fn) {
  var old = obj[method];

  obj[method] = function () {
    fn.call(this);
    old.apply(this, arguments);
  };
}

/**
 * Prompt for confirmation on STDOUT/STDIN
 */

function confirm(msg, callback) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(msg, function (input) {
    rl.close();
    callback(/^y|yes|ok|true$/i.test(input));
  });
}

/**
 * Copy file from template directory.
 */

function copyTemplate(from, to) {
  write(to, fs.readFileSync(path.join(TEMPLATE_DIR, from), "utf-8"));
}

/**
 * Copy multiple files from template directory.
 */

function copyTemplateMulti(fromDir, toDir, nameGlob) {
  fs.readdirSync(path.join(TEMPLATE_DIR, fromDir))
    .filter(minimatch.filter(nameGlob, { matchBase: true }))
    .forEach(function (name) {
      copyTemplate(path.join(fromDir, name), path.join(toDir, name));
    });
}

/**
 * Create application at the given directory.
 *
 * @param {string} name
 * @param {string} dir
 */

async function createApplication(name, dir) {
  console.log();

  // Package
  var pkg = {
    name: name,
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      start: "node ./bin/www.js"
    },
    dependencies: {
      debug: "~2.6.9",
      express: "~4.16.1"
    },
    devDependencies: {}
  };

  if (program.pg) {
    pkg.dependencies.pg = "^8.7.1";
    if (program.dev) {
      pkg.devDependencies.dotenv = "^10.0.0";
      pkg.scripts["db:createusers"] =
        "node -r dotenv/config ./db/scripts/users/createTable.js";
    } else {
      pkg.scripts["db:createusers"] = "node ./db/scripts/users/createTable.js";
    }
  }

  if (program.dev) {
    pkg.devDependencies.dotenv = "^10.0.0";
    pkg.devDependencies.nodemon = "^2.0.15";
    pkg.scripts.dev = "nodemon -r dotenv/config ./bin/www.js";
  }

  // JavaScript
  var app = loadTemplate("js/app.js");
  var www = loadTemplate("js/www.js");

  // App name
  www.locals.name = name;

  // App modules
  app.locals.localModules = Object.create(null);
  app.locals.modules = Object.create(null);
  app.locals.mounts = [];
  app.locals.uses = [];

  // Request logger
  app.locals.modules.logger = "morgan";
  app.locals.uses.push("logger('dev')");
  pkg.dependencies.morgan = "~1.9.1";

  // Body parsers
  app.locals.uses.push("express.json()");
  app.locals.uses.push("express.urlencoded({ extended: false })");

  // Cookie parser
  app.locals.modules.cookieParser = "cookie-parser";
  app.locals.uses.push("cookieParser()");
  pkg.dependencies["cookie-parser"] = "~1.4.4";

  if (dir !== ".") {
    mkdir(dir, ".");
  }

  mkdir(dir, "public");
  mkdir(dir, "public/js");
  mkdir(dir, "public/images");
  mkdir(dir, "public/css");

  if (program.pg) {
    await mkdir(dir, "models");
    await mkdir(dir, "db");
    await mkdir(dir, "db/scripts");
    await mkdir(dir, "db/scripts/users");
    copyTemplate("models/users.js", path.join(dir, "models", "users.js"));
    copyTemplate("db/connection.js", path.join(dir, "db", "connection.js"));
    copyTemplate(
      "db/scripts/users/createTable.js",
      path.join(dir, "db", "scripts", "users", "createTable.js")
    );
  }

  // copy css templates
  copyTemplateMulti("css", dir + "/public/css", "*.css");

  // copy route templates
  mkdir(dir, "routes");
  copyTemplateMulti("js/routes", dir + "/routes", "*.js");

  // Copy extra public files
  copyTemplate("js/index.html", path.join(dir, "public/index.html"));

  app.locals.modules.__dirname = "./dirname.js";

  // User router mount
  app.locals.localModules.usersRouter = "./routes/users.js";
  app.locals.mounts.push({ path: "/users", code: "usersRouter" });

  // No template support
  app.locals.view = false;

  // Static files
  app.locals.uses.push(`express.static(path.join(__dirname, "public"))`);

  if (program.git) {
    copyTemplate("js/gitignore", path.join(dir, ".gitignore"));
  }

  copyTemplate("js/dirname.js", path.join(dir, "dirname.js"));

  // sort dependencies like npm(1)
  pkg.dependencies = sortedObject(pkg.dependencies);

  // write files
  write(path.join(dir, "app.js"), app.render());
  write(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  mkdir(dir, "bin");
  write(path.join(dir, "bin/www.js"), www.render(), MODE_0755);

  var prompt = launchedFromCmd() ? ">" : "$";

  if (dir !== ".") {
    console.log();
    console.log("   change directory:");
    console.log("     %s cd %s", prompt, dir);
  }

  console.log();
  console.log("   install dependencies:");
  console.log("     %s npm install", prompt);
  console.log();
  console.log("   run the app:");

  if (launchedFromCmd()) {
    console.log("     %s SET DEBUG=%s:* & npm start", prompt, name);
  } else {
    console.log("     %s DEBUG=%s:* npm start", prompt, name);
  }

  console.log();
}

/**
 * Create an app name from a directory path, fitting npm naming requirements.
 *
 * @param {String} pathName
 */

function createAppName(pathName) {
  return path
    .basename(pathName)
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^[-_.]+|-+$/g, "")
    .toLowerCase();
}

/**
 * Check if the given directory `dir` is empty.
 *
 * @param {String} dir
 * @param {Function} fn
 */

function emptyDirectory(dir, fn) {
  fs.readdir(dir, function (err, files) {
    if (err && err.code !== "ENOENT") throw err;
    fn(!files || !files.length);
  });
}

/**
 * Graceful exit for async STDIO
 */

function exit(code) {
  // flush output for Node.js Windows pipe bug
  // https://github.com/joyent/node/issues/6247 is just one bug example
  // https://github.com/visionmedia/mocha/issues/333 has a good discussion
  function done() {
    if (!draining--) _exit(code);
  }

  var draining = 0;
  var streams = [process.stdout, process.stderr];

  exit.exited = true;

  streams.forEach(function (stream) {
    // submit empty write request and wait for completion
    draining += 1;
    stream.write("", done);
  });

  done();
}

/**
 * Determine if launched from cmd.exe
 */

function launchedFromCmd() {
  return process.platform === "win32" && process.env._ === undefined;
}

/**
 * Load template file.
 */

function loadTemplate(name) {
  var contents = fs.readFileSync(
    path.join(__dirname, "..", "templates", name + ".ejs"),
    "utf-8"
  );
  var locals = Object.create(null);

  function render() {
    return ejs.render(contents, locals, {
      escape: util.inspect
    });
  }

  return {
    locals: locals,
    render: render
  };
}

/**
 * Main program.
 */

function main() {
  // Path
  var destinationPath = program.args.shift() || ".";

  // App name
  var appName = createAppName(path.resolve(destinationPath)) || "hello-world";

  // Generate application
  emptyDirectory(destinationPath, function (empty) {
    if (empty || program.force) {
      createApplication(appName, destinationPath);
    } else {
      confirm("destination is not empty, continue? [y/N] ", function (ok) {
        if (ok) {
          process.stdin.destroy();
          createApplication(appName, destinationPath);
        } else {
          console.error("aborting");
          exit(1);
        }
      });
    }
  });
}

/**
 * Make the given dir relative to base.
 *
 * @param {string} base
 * @param {string} dir
 */

function mkdir(base, dir) {
  var loc = path.join(base, dir);

  console.log("   \x1b[36mcreate\x1b[0m : " + loc + path.sep);
  mkdirp.sync(loc, MODE_0755);
}

/**
 * Generate a callback function for commander to warn about renamed option.
 *
 * @param {String} originalName
 * @param {String} newName
 */

function renamedOption(originalName, newName) {
  return function (val) {
    warning(
      util.format("option `%s' has been renamed to `%s'", originalName, newName)
    );
    return val;
  };
}

/**
 * Display a warning similar to how errors are displayed by commander.
 *
 * @param {String} message
 */

function warning(message) {
  console.error();
  message.split("\n").forEach(function (line) {
    console.error("  warning: %s", line);
  });
  console.error();
}

/**
 * echo str > file.
 *
 * @param {String} file
 * @param {String} str
 */

function write(file, str, mode) {
  fs.writeFileSync(file, str, { mode: mode || MODE_0666 });
  console.log("   \x1b[36mcreate\x1b[0m : " + file);
}
