import test from "node:test";
import assert from "node:assert/strict";
import { UsageError } from "../src/args.js";
import { resolveTarget, runRelease } from "../scripts/release.js";

const HEAD = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const PKG = { name: "example-package", version: "1.2.3" };
const CHECK = "npm run check";
const MUTATING = /^(git (tag|push|commit)|npm (version|publish))\b/;
const PRECONDITION_COMMANDS = [
  "git rev-parse --abbrev-ref HEAD",
  "git status --porcelain",
  "git fetch origin",
  "git rev-list --left-right --count HEAD...origin/main",
  "npm whoami",
  "npm view example-package@1.2.3 version --json",
  "git rev-parse -q --verify refs/tags/v1.2.3^{commit}",
];

const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const fail = (stderr = "", status = 1) => ({ status, stdout: "", stderr });

const DEFAULTS = {
  "git rev-parse --abbrev-ref HEAD": ok("main\n"),
  "git rev-parse HEAD": ok(`${HEAD}\n`),
  "git rev-parse -q --verify refs/tags/": fail(),
  "git rev-list ": ok("1\t0\n"),
  "npm whoami": ok("someone\n"),
  "npm view ": fail("npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/example-package - Not found\n"),
};

function harness(overrides = {}, options = {}) {
  const calls = [];
  const inherited = [];
  const lines = [];
  const table = [...Object.entries(overrides), ...Object.entries(DEFAULTS)];
  const run = (command, args, { inherit = false } = {}) => {
    const call = [command, ...args].join(" ");
    calls.push(call);
    if (inherit) inherited.push(call);
    return table.find(([prefix]) => call.startsWith(prefix))?.[1] ?? ok();
  };

  return {
    calls,
    inherited,
    release: (argv = []) =>
      runRelease(argv, {
        run,
        pkg: PKG,
        config: { branches: { staging: "staging", production: "main" } },
        log: (line) => lines.push(line),
        ...options,
      }),
    mutating: () => calls.filter((call) => MUTATING.test(call)),
    steps: () => calls.filter((call) => call === CHECK || MUTATING.test(call)),
    output: () => lines.join("\n"),
  };
}

const FAILING_PRECONDITIONS = {
  "another branch": [
    { "git rev-parse --abbrev-ref HEAD": ok("feature/x\n") },
    /^the current branch is feature\/x, not the production branch main$/,
  ],
  "a dirty working tree": [{ "git status --porcelain": ok(" M src/cli.js\n?? notes.txt\n") }, /uncommitted changes/],
  "a failed fetch": [{ "git fetch origin": fail("fatal: unable to access the remote") }, /^git fetch origin failed: fatal/],
  "a branch that is behind": [{ "git rev-list ": ok("0\t2\n") }, /^HEAD is 2 commits behind origin\/main; pull first$/],
  "a branch that has diverged": [{ "git rev-list ": ok("1\t2\n") }, /diverged from origin\/main \(1 ahead, 2 behind\)/],
  "no npm login": [
    {
      "npm whoami": fail(
        "npm error code E401\nnpm error 401 Unauthorized - GET https://registry.npmjs.org/-/whoami\nnpm error A complete log of this run can be found in: /logs/debug-0.log\n",
      ),
    },
    /^npm whoami failed; run npm login first \(code E401; 401 Unauthorized - GET https:\/\/registry\.npmjs\.org\/-\/whoami\)$/,
  ],
  "a version already on npm": [{ "npm view ": ok('"1.2.3"\n') }, /^example-package@1\.2\.3 is already on npm$/],
  "a tag on another commit": [
    { "git rev-parse -q --verify refs/tags/": ok(`${OTHER}\n`) },
    /^tag v1\.2\.3 exists but points at 2222222, not HEAD \(1111111\)$/,
  ],
};

for (const [name, [overrides, expected]] of Object.entries(FAILING_PRECONDITIONS)) {
  test(`release refuses ${name} and changes nothing`, () => {
    const release = harness(overrides);
    const result = release.release();

    assert.equal(result.code, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], expected);
    assert.deepEqual(release.steps(), []);
    assert.match(release.output(), /FAIL  /);
    assert.match(release.output(), /Release refused: 1 of 6 preconditions failed\. Nothing was changed\./);

    for (const command of PRECONDITION_COMMANDS) {
      if (command.startsWith("git rev-list") && name === "a failed fetch") continue;
      assert.ok(release.calls.includes(command), `still checked: ${command}`);
    }
  });
}

test("release reports every failed precondition, not only the first", () => {
  const release = harness({
    "git rev-parse --abbrev-ref HEAD": ok("feature/x\n"),
    "git status --porcelain": ok(" M README.md\n"),
    "git rev-list ": ok("0\t1\n"),
    "npm whoami": fail("npm error code ENEEDAUTH\n"),
    "npm view ": ok('"1.2.3"\n'),
    "git rev-parse -q --verify refs/tags/": ok(`${OTHER}\n`),
  });
  const result = release.release();

  assert.equal(result.code, 1);
  assert.equal(result.failures.length, 6);
  assert.match(result.failures.join("\n"), /feature\/x[\s\S]*uncommitted[\s\S]*1 commit behind[\s\S]*npm login[\s\S]*already on npm[\s\S]*tag v1\.2\.3 exists/);
  for (const failure of result.failures) assert.ok(release.output().includes(`FAIL  ${failure}`));
  assert.deepEqual(release.steps(), []);
});

test("release refuses a bump whose tag already exists", () => {
  const release = harness({ "git rev-parse -q --verify refs/tags/": ok(`${HEAD}\n`) });
  const result = release.release(["patch"]);

  assert.equal(result.code, 1);
  assert.deepEqual(result.failures, ["tag v1.2.4 already exists"]);
  assert.deepEqual(release.steps(), []);
});

test("release refuses a prerelease version in package.json", () => {
  const release = harness({}, { pkg: { name: "example-package", version: "1.3.0-beta.1" } });
  const result = release.release();

  assert.equal(result.code, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /1\.3\.0-beta\.1 is not a plain x\.y\.z version/);
  assert.deepEqual(release.steps(), []);
});

test("release without a bump runs check, tag, push, and publish in that order", () => {
  const release = harness();
  const result = release.release();

  assert.equal(result.code, 0);
  assert.equal(result.version, "1.2.3");
  assert.deepEqual(result.failures, []);
  assert.deepEqual(release.steps(), [
    CHECK,
    "git tag -a v1.2.3 -m Release 1.2.3",
    "git push --atomic origin main refs/tags/v1.2.3",
    "npm publish",
  ]);
  assert.deepEqual(release.calls.slice(0, 8), [...PRECONDITION_COMMANDS.slice(0, 6), "git rev-parse HEAD", PRECONDITION_COMMANDS[6]]);
  assert.equal(release.calls.indexOf(CHECK), 8);
  assert.deepEqual(release.inherited, [CHECK, "git push --atomic origin main refs/tags/v1.2.3", "npm publish"]);

  const output = release.output();
  assert.match(output, /Released example-package 1\.2\.3/);
  assert.match(output, /https:\/\/www\.npmjs\.com\/package\/example-package\/v\/1\.2\.3/);
  assert.ok(output.includes(`commit: ${HEAD} on origin/main, tagged v1.2.3`));
  assert.equal(result.commit, HEAD);
});

for (const [bump, version] of [
  ["patch", "1.2.4"],
  ["minor", "1.3.0"],
  ["major", "2.0.0"],
  ["3.0.1", "3.0.1"],
]) {
  test(`release with ${bump} checks first, then versions, pushes, and publishes ${version}`, () => {
    const release = harness();
    const result = release.release([bump]);

    assert.equal(result.code, 0);
    assert.equal(result.version, version);
    assert.deepEqual(release.steps(), [
      CHECK,
      `npm version ${version} -m Release %s`,
      `git push --atomic origin main refs/tags/v${version}`,
      "npm publish",
    ]);
    assert.ok(release.calls.includes(`npm view example-package@${version} version --json`));
    assert.ok(release.calls.includes(`git rev-parse -q --verify refs/tags/v${version}^{commit}`));
    assert.ok(!release.calls.some((call) => call.startsWith("git tag")));
    assert.match(release.output(), new RegExp(`Releasing example-package ${version.replaceAll(".", "\\.")} \\(currently 1\\.2\\.3\\)`));
  });
}

test("release stops at a failing check before any commit, tag, push, or publish", () => {
  for (const argv of [[], ["minor"]]) {
    const release = harness({ [CHECK]: fail("", 1) });
    const result = release.release(argv);

    assert.equal(result.code, 1);
    assert.deepEqual(result.failures, ["npm run check failed"]);
    assert.deepEqual(release.steps(), [CHECK]);
    assert.equal(release.calls.at(-1), CHECK);
    assert.match(release.output(), /npm run check failed\. Nothing was committed, tagged, pushed, or published\./);
  }
});

test("release stops when a step fails and says what was left undone", () => {
  const versioning = harness({ "npm version": fail("npm error Git working directory not clean.\n") });
  assert.equal(versioning.release(["patch"]).code, 1);
  assert.deepEqual(versioning.steps(), [CHECK, "npm version 1.2.4 -m Release %s"]);
  assert.match(versioning.output(), /failed \(Git working directory not clean\.\)\. Nothing was pushed or published\./);

  const pushing = harness({ "git push": fail() });
  assert.equal(pushing.release().code, 1);
  assert.deepEqual(pushing.steps(), [CHECK, "git tag -a v1.2.3 -m Release 1.2.3", "git push --atomic origin main refs/tags/v1.2.3"]);
  assert.match(pushing.output(), /Nothing was published\. Fix the cause, then run "npm run release" again with no argument\./);
});

test("release can be run again to finish after publish failed", () => {
  const first = harness({ "npm publish": fail() });
  const failed = first.release(["patch"]);

  assert.equal(failed.code, 1);
  assert.deepEqual(first.steps(), [
    CHECK,
    "npm version 1.2.4 -m Release %s",
    "git push --atomic origin main refs/tags/v1.2.4",
    "npm publish",
  ]);
  assert.match(first.output(), /Run "npm run release" again with no argument to finish publishing 1\.2\.4\./);
  assert.doesNotMatch(first.output(), /Released example-package/);

  const second = harness(
    { "git rev-parse -q --verify refs/tags/": ok(`${HEAD}\n`), "git rev-list ": ok("0\t0\n") },
    { pkg: { name: "example-package", version: "1.2.4" } },
  );
  const finished = second.release();

  assert.equal(finished.code, 0);
  assert.equal(finished.version, "1.2.4");
  assert.deepEqual(second.steps(), [CHECK, "git push --atomic origin main refs/tags/v1.2.4", "npm publish"]);
  assert.match(second.output(), /ok {4}tag v1\.2\.4 already points at HEAD/);
  assert.match(second.output(), /Released example-package 1\.2\.4/);
});

test("release --dry-run runs the checks, prints the plan, and changes nothing", () => {
  const plain = harness();
  const result = plain.release(["--dry-run"]);

  assert.equal(result.code, 0);
  assert.equal(result.dryRun, true);
  assert.deepEqual(plain.steps(), [CHECK]);
  for (const command of PRECONDITION_COMMANDS) assert.ok(plain.calls.includes(command), command);
  assert.match(plain.output(), /Releasing example-package 1\.2\.3 — dry run/);
  assert.match(plain.output(), /Dry run: nothing was committed, tagged, pushed, or published\./);
  assert.match(plain.output(), /1\. git tag -a v1\.2\.3 -m "Release 1\.2\.3"\n {2}2\. git push --atomic origin main refs\/tags\/v1\.2\.3\n {2}3\. npm publish/);
  assert.doesNotMatch(plain.output(), /Released example-package/);

  const bumped = harness();
  assert.equal(bumped.release(["--dry-run", "minor"]).version, "1.3.0");
  assert.deepEqual(bumped.steps(), [CHECK]);
  assert.match(bumped.output(), /1\. npm version 1\.3\.0 -m "Release %s"\n {2}2\. git push --atomic origin main refs\/tags\/v1\.3\.0\n {2}3\. npm publish/);

  const rerun = harness({ "git rev-parse -q --verify refs/tags/": ok(`${HEAD}\n`) });
  assert.equal(rerun.release(["--dry-run"]).code, 0);
  assert.deepEqual(rerun.steps(), [CHECK]);
  assert.match(rerun.output(), /1\. git push --atomic[^\n]*\n {2}2\. npm publish\n {2}\(v1\.2\.3 already points at HEAD, so no tag would be created\)/);

  const refused = harness({ "git status --porcelain": ok(" M README.md\n") });
  assert.equal(refused.release(["--dry-run"]).code, 1);
  assert.deepEqual(refused.steps(), []);
});

test("release treats npm's own --dry-run flag as a dry run", () => {
  const release = harness({}, { env: { npm_config_dry_run: "true" } });
  const result = release.release(["patch"]);

  assert.equal(result.code, 0);
  assert.equal(result.dryRun, true);
  assert.deepEqual(release.steps(), [CHECK]);
});

test("release accepts a version the registry does not have and refuses anything else", () => {
  const accepted = {
    "package not found": fail("npm error code E404\nnpm error 404 Not Found\n"),
    "not found reported as JSON": { status: 1, stdout: '{"error":{"code":"E404","summary":"Not found"}}', stderr: "" },
    "package exists without this version": ok(""),
  };
  const refused = {
    "already published": [ok('"1.2.3"\n'), /^example-package@1\.2\.3 is already on npm$/],
    "registry unreachable": [
      fail("npm error code ETIMEDOUT\nnpm error network request to https://registry.npmjs.org failed\n"),
      /^could not check npm for example-package@1\.2\.3: code ETIMEDOUT; network request to /,
    ],
    "registry error": [fail("npm error code E500\n"), /^could not check npm for example-package@1\.2\.3: code E500$/],
  };

  for (const [name, response] of Object.entries(accepted)) {
    const release = harness({ "npm view ": response });
    assert.equal(release.release().code, 0, name);
    assert.equal(release.steps().at(-1), "npm publish", name);
  }

  for (const [name, [response, expected]] of Object.entries(refused)) {
    const release = harness({ "npm view ": response });
    const result = release.release();
    assert.equal(result.code, 1, name);
    assert.equal(result.failures.length, 1, name);
    assert.match(result.failures[0], expected, name);
    assert.deepEqual(release.steps(), [], name);
  }
});

test("release rejects an invalid argument as a usage error before running anything", () => {
  for (const argv of [["banana"], ["1.2"], ["v1.3.0"], ["2.0.0-beta.1"], ["1.2.3"], ["1.2.2"], ["patch", "minor"], ["--force"]]) {
    const release = harness();
    assert.throws(() => release.release(argv), UsageError, argv.join(" "));
    assert.deepEqual(release.calls, [], argv.join(" "));
  }

  assert.throws(() => resolveTarget("1.3.0-beta.1", "patch"), /Pass an explicit x\.y\.z version/);
  assert.equal(resolveTarget("1.3.0-beta.1", "1.3.0"), "1.3.0");
  assert.equal(resolveTarget("1.9.9", "1.10.0"), "1.10.0");
});

test("release uses the configured production branch and falls back to main", () => {
  const configured = harness({ "git rev-parse --abbrev-ref HEAD": ok("stable\n") }, { config: { branches: { production: "stable" } } });
  assert.equal(configured.release().code, 0);
  assert.ok(configured.calls.includes("git rev-list --left-right --count HEAD...origin/stable"));
  assert.ok(configured.steps().includes("git push --atomic origin stable refs/tags/v1.2.3"));

  const fallback = harness({}, { config: {} });
  assert.equal(fallback.release().code, 0);
  assert.ok(fallback.steps().includes("git push --atomic origin main refs/tags/v1.2.3"));

  const wrong = harness({}, { config: { branches: { production: "stable" } } });
  assert.deepEqual(wrong.release().failures, ["the current branch is main, not the production branch stable"]);
});

test("release --help prints usage and runs nothing", () => {
  const release = harness();

  assert.equal(release.release(["--help"]).code, 0);
  assert.deepEqual(release.calls, []);
  assert.match(release.output(), /npm run release -- --dry-run/);
});
