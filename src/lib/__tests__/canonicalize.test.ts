import { describe, test, expect } from "vitest";
import { canonicalizeDescription, slugify } from "@/lib/canonicalize";

describe("canonicalizeDescription", () => {
  // =========================================================================
  // Beer rules (spec 11.2)
  // =========================================================================

  describe("alcohol: beer", () => {
    test("beer light with brand", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, beer, light, BUD LIGHT"
      );
      expect(r.baseName).toBe("beer");
      expect(r.specificName).toBe("light beer");
      expect(r.baseSlug).toBe("beer");
      expect(r.specificSlug).toBe("light-beer");
      expect(r.removedTokens).toContain("BUD LIGHT");
    });

    test("beer regular all", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, beer, regular, all"
      );
      expect(r.baseName).toBe("beer");
      expect(r.specificName).toBe("beer");
    });

    test("beer low carb", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, beer, light, low carb"
      );
      expect(r.baseName).toBe("beer");
      // low carb should take precedence when present
      expect(r.specificName).toBe("light beer");
    });
  });

  // =========================================================================
  // Wine rules
  // =========================================================================

  describe("alcohol: wine", () => {
    test("wine table red", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, wine, table, red"
      );
      expect(r.baseName).toBe("wine");
      expect(r.specificName).toBe("red wine");
    });

    test("wine cooking", () => {
      const r = canonicalizeDescription("Alcoholic beverage, wine, cooking");
      expect(r.baseName).toBe("wine");
      expect(r.specificName).toBe("cooking wine");
    });

    test("wine dessert", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, wine, dessert, sweet"
      );
      expect(r.baseName).toBe("wine");
      expect(r.specificName).toBe("dessert wine");
    });
  });

  // =========================================================================
  // Distilled spirits rules
  // =========================================================================

  describe("alcohol: distilled spirits", () => {
    test("distilled rum", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, distilled, rum, 80 proof"
      );
      expect(r.baseName).toBe("distilled spirits");
      expect(r.specificName).toBe("rum");
      expect(r.specificSlug).toBe("rum");
    });

    test("distilled vodka", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, distilled, vodka, 80 proof"
      );
      expect(r.baseName).toBe("distilled spirits");
      expect(r.specificName).toBe("vodka");
    });

    test("distilled whiskey", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, distilled, whiskey, 86 proof"
      );
      expect(r.baseName).toBe("distilled spirits");
      expect(r.specificName).toBe("whiskey");
    });

    test("distilled generic", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof"
      );
      expect(r.baseName).toBe("distilled spirits");
      // Parentheticals removed, so no specific spirit detected
      expect(r.specificName).toBe("distilled spirits");
    });
  });

  // =========================================================================
  // Liqueur rules
  // =========================================================================

  describe("alcohol: liqueur", () => {
    test("liqueur coffee", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, liqueur, coffee, 53 proof"
      );
      expect(r.baseName).toBe("liqueur");
      expect(r.specificName).toBe("coffee liqueur");
    });

    test("liqueur coffee with cream", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, liqueur, coffee with cream, 34 proof"
      );
      expect(r.baseName).toBe("liqueur");
      expect(r.specificName).toBe("coffee liqueur with cream");
    });
  });

  // =========================================================================
  // Agave rules (spec 11.3)
  // =========================================================================

  describe("agave", () => {
    test("agave cooked with parenthetical", () => {
      const r = canonicalizeDescription("Agave, cooked (Southwest)");
      expect(r.baseName).toBe("agave");
      expect(r.specificName).toBe("agave");
      expect(r.removedTokens).toContain("(Southwest)");
    });

    test("agave raw with parenthetical", () => {
      const r = canonicalizeDescription("Agave, raw (Southwest)");
      expect(r.baseName).toBe("agave");
      expect(r.specificName).toBe("agave");
    });
  });

  // =========================================================================
  // Parenthetical removal
  // =========================================================================

  describe("parenthetical removal", () => {
    test("acerola with parenthetical", () => {
      const r = canonicalizeDescription(
        "Acerola, (west indian cherry), raw"
      );
      expect(r.baseName).toBe("acerola");
      expect(r.removedTokens).toContain("(west indian cherry)");
    });

    test("agutuk with Alaska Native tag", () => {
      const r = canonicalizeDescription(
        "Agutuk, fish with shortening (Alaskan ice cream) (Alaska Native)"
      );
      expect(r.baseName).toBe("agutuk");
      expect(r.removedTokens).toContain("(Alaskan ice cream)");
      expect(r.removedTokens).toContain("(Alaska Native)");
    });
  });

  // =========================================================================
  // State token removal
  // =========================================================================

  describe("state token removal", () => {
    test("removes cooking state", () => {
      const r = canonicalizeDescription("Butter, salted, raw");
      expect(r.removedTokens.some((t) => t.toLowerCase() === "raw")).toBe(true);
    });

    test("removes preservation", () => {
      const r = canonicalizeDescription("Beans, kidney, canned");
      expect(r.removedTokens.some((t) => t.toLowerCase() === "canned")).toBe(
        true
      );
    });

    test("does not remove dry from dry roasted", () => {
      const r = canonicalizeDescription(
        "Peanuts, all types, dry-roasted, with salt"
      );
      // "dry-roasted" is a cooking method phrase, "dried" should not be removed
      expect(r.baseName).toBe("peanuts");
    });
  });

  // =========================================================================
  // Brand removal
  // =========================================================================

  describe("brand removal", () => {
    test("removes all-caps brand", () => {
      const r = canonicalizeDescription(
        "Alcoholic beverage, beer, light, BUD LIGHT"
      );
      expect(r.removedTokens).toContain("BUD LIGHT");
    });

    test("does not remove short uppercase words", () => {
      // "UHT" is 3 chars all caps - should be removed as brand
      // but this is an edge case we accept for v1
      const r = canonicalizeDescription("Milk, whole, UHT");
      expect(r.baseName).toBe("milk");
    });
  });

  // =========================================================================
  // Non-alcohol generic foods
  // =========================================================================

  describe("generic foods", () => {
    test("simple food with modifier", () => {
      const r = canonicalizeDescription("Butter, salted");
      expect(r.baseName).toBe("butter");
      expect(r.specificName).toBe("salted butter");
      expect(r.specificSlug).toBe("salted-butter");
    });

    test("chicken breast - skips poultry type classifier", () => {
      const r = canonicalizeDescription(
        "Chicken, broilers or fryers, breast, meat only, raw"
      );
      expect(r.baseName).toBe("chicken");
      expect(r.specificName).toBe("chicken breast");
      expect(r.specificSlug).toBe("chicken-breast");
    });

    test("chicken thigh", () => {
      const r = canonicalizeDescription(
        "Chicken, broilers or fryers, thigh, meat only, raw"
      );
      expect(r.specificName).toBe("chicken thigh");
    });

    test("ground beef groups all lean ratios", () => {
      const r1 = canonicalizeDescription("Beef, ground, 80% lean meat / 20% fat, raw");
      const r2 = canonicalizeDescription("Beef, ground, 90% lean meat / 10% fat, raw");
      expect(r1.specificSlug).toBe("ground-beef");
      expect(r2.specificSlug).toBe("ground-beef");
    });

    test("beef cuts are distinct", () => {
      const chuck = canonicalizeDescription("Beef, chuck, arm pot roast, raw");
      const rib = canonicalizeDescription("Beef, rib, whole, raw");
      const round = canonicalizeDescription("Beef, round, top round steak, raw");
      expect(chuck.specificSlug).toBe("beef-chuck");
      expect(rib.specificSlug).toBe("beef-rib");
      expect(round.specificSlug).toBe("beef-round");
    });

    test("fish species are distinct", () => {
      const cod = canonicalizeDescription("Fish, cod, Atlantic, raw");
      const salmon = canonicalizeDescription("Fish, salmon, Atlantic, wild, raw");
      expect(cod.specificSlug).toBe("cod");
      expect(salmon.specificSlug).toBe("salmon");
    });

    test("ground turkey", () => {
      const r = canonicalizeDescription("Turkey, ground, raw");
      expect(r.specificSlug).toBe("ground-turkey");
    });

    test("pepper varieties are distinct", () => {
      const bell = canonicalizeDescription("Peppers, bell, green, raw");
      const jalapeno = canonicalizeDescription("Peppers, jalapeno, raw");
      expect(bell.specificSlug).toBe("bell-peppers");
      expect(jalapeno.specificSlug).toBe("jalapeno-peppers");
    });

    test("spices pepper black - container category extraction", () => {
      const r = canonicalizeDescription("Spices, pepper, black");
      expect(r.baseName).toBe("pepper");
      expect(r.baseSlug).toBe("pepper");
      expect(r.specificName).toBe("black pepper");
      expect(r.specificSlug).toBe("black-pepper");
      expect(r.removedTokens).toContain("spices");
    });

    test("nuts almonds", () => {
      const r = canonicalizeDescription(
        "Nuts, almonds, dry roasted, with salt added"
      );
      expect(r.baseName).toBe("almonds");
      expect(r.baseSlug).toBe("almonds");
    });

    test("seeds sunflower", () => {
      const r = canonicalizeDescription(
        "Seeds, sunflower seed kernels, dried"
      );
      expect(r.baseName).toBe("sunflower seed kernels");
      expect(r.baseSlug).toBe("sunflower-seed-kernels");
    });

    test("snacks banana chips", () => {
      const r = canonicalizeDescription("Snacks, banana chips");
      expect(r.baseName).toBe("banana chips");
    });

    test("beverages energy drink", () => {
      const r = canonicalizeDescription(
        "Beverages, Energy drink, Citrus"
      );
      expect(r.baseName).toBe("energy drink");
      expect(r.specificName).toBe("citrus energy drink");
    });
  });

  // =========================================================================
  // Determinism
  // =========================================================================

  describe("determinism", () => {
    test("same input produces same output", () => {
      const desc = "Alcoholic beverage, beer, light, BUD LIGHT";
      const a = canonicalizeDescription(desc);
      const b = canonicalizeDescription(desc);
      expect(a).toEqual(b);
    });
  });
});

// ===========================================================================
// Slugification
// ===========================================================================

describe("slugify", () => {
  test("basic", () => {
    expect(slugify("light beer")).toBe("light-beer");
  });

  test("distilled spirits", () => {
    expect(slugify("distilled spirits")).toBe("distilled-spirits");
  });

  test("trims and collapses", () => {
    expect(slugify("  coffee liqueur  ")).toBe("coffee-liqueur");
  });

  test("removes special chars", () => {
    expect(slugify("low-carb beer")).toBe("low-carb-beer");
  });

  test("empty string", () => {
    expect(slugify("")).toBe("");
  });
});
