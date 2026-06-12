import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

function createBrowserContext() {
  const elements = new Map();
  const makeElement = () => ({
    addEventListener() {},
    appendChild() {},
    click() {},
    remove() {},
    querySelector() {
      return makeElement();
    },
    querySelectorAll() {
      return [];
    },
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    content: {
      cloneNode() {
        return makeElement();
      }
    },
    dataset: {},
    files: [],
    style: {},
    value: "",
    checked: false,
    hidden: false,
    innerHTML: "",
    textContent: "",
    href: "",
    type: "text"
  });

  const document = {
    body: makeElement(),
    createElement: makeElement,
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, makeElement());
      return elements.get(selector);
    },
    querySelectorAll() {
      return [];
    }
  };

  return {
    alert() {},
    confirm() {
      return true;
    },
    crypto: {
      randomUUID() {
        return "00000000-0000-4000-8000-000000000000";
      }
    },
    document,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    location: { hash: "" },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    },
    window: {
      addEventListener() {}
    }
  };
}

test("catalog import strips a UTF-8 BOM from the title header", async () => {
  const source = await readFile("outputs/jazz-content-scheduler/app.js", "utf8");
  const context = createBrowserContext();
  vm.runInNewContext(source, context);

  const rows = context.parseCatalog("\uFEFFTitle,Artist,Album,ISRC\nSteam Song,Maja,Test Album,ABC123");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Steam Song");
  assert.equal(rows[0].artist, "Maja");
  assert.equal(rows[0].isrc, "ABC123");
});
