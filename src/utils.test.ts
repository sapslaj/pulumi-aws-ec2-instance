import * as pulumi from "@pulumi/pulumi";
import t from "tap";

import { deDoubleNegativeify, deDoubleNegativeifyOptional, mergeTags } from "./utils";

t.test("deDoubleNegativeifyOptional", async (t) => {
  t.test("with only positive", (t) => {
    deDoubleNegativeifyOptional(
      (v) => v === "yes" ? "no" : "yes",
      "yes",
      undefined,
    )!.apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with only negative", (t) => {
    deDoubleNegativeifyOptional(
      (v) => v === "yes" ? "no" : "yes",
      undefined,
      "no",
    )!.apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with positive and negative", (t) => {
    deDoubleNegativeifyOptional(
      (v) => v === "yes" ? "no" : "yes",
      "yes",
      "no",
    )!.apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with default value", (t) => {
    deDoubleNegativeifyOptional(
      (v) => v === "yes" ? "no" : "yes",
      undefined,
      undefined,
      "default",
    )!.apply((v) => {
      t.equal(v, "default");
      t.end();
    });
  });

  t.test("undefined", (t) => {
    t.equal(
      deDoubleNegativeifyOptional<string>(
        (v) => v === "yes" ? "no" : "yes",
        undefined,
        undefined,
      ),
      undefined,
    );
    t.end();
  });
});

t.test("deDoubleNegativeify", async (t) => {
  t.test("with only positive", (t) => {
    deDoubleNegativeify(
      (v) => v === "yes" ? "no" : "yes",
      "yes",
      undefined,
      "default",
    ).apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with only negative", (t) => {
    deDoubleNegativeify(
      (v) => v === "yes" ? "no" : "yes",
      undefined,
      "no",
      "default",
    ).apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with positive and negative", (t) => {
    deDoubleNegativeify(
      (v) => v === "yes" ? "no" : "yes",
      "yes",
      "no",
      "default",
    ).apply((v) => {
      t.equal(v, "no");
      t.end();
    });
  });

  t.test("with default value", (t) => {
    deDoubleNegativeify(
      (v) => v === "yes" ? "no" : "yes",
      undefined,
      undefined,
      "default",
    ).apply((v) => {
      t.equal(v, "default");
      t.end();
    });
  });
});

t.test("mergeTags", async (t) => {
  t.test("merges tags", (t) => {
    const tags = mergeTags(
      {
        Tag1: "foo",
        Tag2: "overriden",
      },
      undefined,
      {
        Tag2: pulumi.output("bar"),
        Tag3: "baz",
      },
    );

    pulumi.all({ tags }).apply(({ tags }) => {
      t.matchOnly(tags, {
        Tag1: "foo",
        Tag2: "bar",
        Tag3: "baz",
      });
      t.end();
    });
  });
});
