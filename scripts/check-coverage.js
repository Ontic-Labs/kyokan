const fs = require("fs");
const ontology = require("../data/ingredient-ontology.json");
const ingredients = JSON.parse(fs.readFileSync("data/recipe-ingredients.json", "utf-8"));

const surfaceLookup = new Set();
for (const e of ontology) {
  surfaceLookup.add(e.slug);
  for (const sf of e.surfaceForms) surfaceLookup.add(sf.toLowerCase().trim());
}

let totalFreq = 0, coveredFreq = 0;
for (const ing of ingredients) {
  totalFreq += ing.frequency;
  const name = ing.name.toLowerCase().trim();
  const slug = name.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (surfaceLookup.has(name) || surfaceLookup.has(slug)) coveredFreq += ing.frequency;
}

const sorted = ingredients.sort((a, b) => b.frequency - a.frequency);
function isMissing(ing) {
  const n = ing.name.toLowerCase().trim();
  const s = n.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return !(surfaceLookup.has(n) || surfaceLookup.has(s));
}

const miss200 = sorted.slice(0, 200).filter(isMissing);
const miss500 = sorted.slice(0, 500).filter(isMissing);

console.log("Entries:", ontology.length);
console.log("Surface forms:", ontology.reduce((a, x) => a + x.surfaceForms.length, 0));
console.log("");
console.log("Frequency-weighted coverage:", (coveredFreq / totalFreq * 100).toFixed(1) + "%");
console.log("Top 200:", (200 - miss200.length) + "/200");
console.log("Top 500:", (500 - miss500.length) + "/500");
console.log("");
console.log("Top 20 still missing:");
const allMissing = sorted.filter(isMissing);
for (const m of allMissing.slice(0, 20)) console.log("  [" + m.frequency + "] " + m.name);
