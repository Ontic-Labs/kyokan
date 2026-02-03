# Recipe-First Canonical Naming: A Non-LLM Approach to Ingredient Identity

> **TL;DR:** Instead of using machine learning to infer what "ground beef" means, we count how many times real recipe authors wrote "ground beef" and use that as the canonical form. The wisdom of crowds replaces the wisdom of weights.

**Methodology:** [Empirical Ontology for High-Stakes Domains](empirical-ontology-pattern.md)

---

## 1. The Problem

FDC (FoodData Central) contains entries like:

```
Beef, ground, 80% lean meat / 20% fat, raw
Beef, ground, 85% lean meat / 15% fat, raw  
Beef, ground, 90% lean meat / 10% fat, raw
Beef, ground, 95% lean meat / 5% fat, patty, cooked, broiled
```

To build a nutrition API that serves recipe applications, we need to answer:

1. **What is the canonical name?** ("ground beef"? "beef ground"? "hamburger"?)
2. **What is the granularity?** (One "ground beef" or four separate entries?)
3. **Which FDC entries belong to which canonical?**

This is fundamentally a **naming and grouping problem** — not a semantic understanding problem.

---

## 2. The Architectural Insight

This approach treats **language as data, not as semantics**.

| Data Source | What It Tells You | Role |
|-------------|-------------------|------|
| **USDA/FDC** | What a molecule is | Chemistry database |
| **Recipe Corpus** | What a human *calls* food | Cultural database |
| **This System** | The bridge between them | Ontology layer |

By relying on frequency distributions (Zipf's law acts as a natural garbage collector), we let the "wisdom of the crowd" perform categorization that inference tools do poorly and expensively.

**The key insight:** 99% of "AI Nutrition" projects try to solve an *ontology* problem with *inference* tools. They're using hammers on screws.

---

## 3. Approach Evolution

### 3.1 Phase 1: Regex-Based Extraction (FDC-First)

Initial approach: parse FDC descriptions using deterministic rules.

```typescript
// Parse "Beef, ground, 80% lean meat / 20% fat, raw"
function canonicalizeDescription(desc: string): CanonicalResult {
  const segments = desc.split(',').map(s => s.trim());
  const base = segments[0];  // "Beef"
  const specific = extractSpecificTokens(segments);  // "ground"
  return { baseName: base, specificName: `${base} ${specific}` };
}
```

**Problems:**
- Word order wrong: produces "beef ground" not "ground beef"
- Arbitrary granularity decisions: should we group all lean ratios?
- No ground truth: why is "ground beef" correct and "minced beef" wrong?
- Endless edge cases: every food category has different patterns

### 3.2 Phase 2: Container Categories and Domain Rules

Added special handling for known patterns:

```typescript
const CONTAINER_CATEGORIES = new Set([
  "spices",   // "Spices, pepper, black" → "black pepper"
  "nuts",     // "Nuts, almonds" → "almonds"
  "seeds",    // "Seeds, sunflower" → "sunflower seeds"
]);

const PROTEIN_BASES = new Set([
  "beef", "pork", "chicken",  // "Chicken, breast" → "chicken breast"
]);
```

**Problems:**
- Still making arbitrary decisions
- Growing list of special cases
- No way to validate correctness
- "Correct" for whom?

### 3.3 Phase 3: Recipe-First (Current)

**Key insight:** Recipe ingredient lists already solved this problem.

Real recipes contain ingredient names written by humans for humans:
- "1 lb ground beef"
- "2 cups flour"
- "1 tsp salt"

These names represent **consensus** — thousands of independent authors converging on the same strings.

---

## 4. The LLM Approach (What We're NOT Doing)

This section documents the typical LLM-first approach in detail — not as a strawman, but because **this is exactly what most engineers (including the author) attempt first**. It feels like the obviously correct approach. It isn't.

### 4.1 The Intuition That Leads You Astray

When you first see the problem:

```
FDC: "Beef, ground, 80% lean meat / 20% fat, raw"
Need: "ground beef"
```

Your brain immediately thinks: "This is a semantic understanding problem. I need to *understand* what this food is and generate an appropriate name."

This intuition is reinforced by:
- LLMs are good at understanding language
- Embeddings capture semantic meaning
- "ground beef" and "Beef, ground..." are clearly about the same thing
- Modern ML can solve this

So you reach for the obvious tools.

### 4.2 The Typical LLM-First Pipeline

**Month 1: Embeddings**

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

fdc_embeddings = {}
for food in fdc_foods:
    fdc_embeddings[food.fdc_id] = model.encode(food.description)

def find_similar(query: str, top_k: int = 10):
    query_emb = model.encode(query)
    similarities = []
    for fdc_id, emb in fdc_embeddings.items():
        sim = cosine_similarity(query_emb, emb)
        similarities.append((fdc_id, sim))
    return sorted(similarities, key=lambda x: -x[1])[:top_k]

find_similar("ground beef")
# Returns: [("Beef, ground, 80%...", 0.73), ("Beef, ground, 85%...", 0.71), ...]
```

This works! You're excited. But then...

**Month 2: Clustering**

You need to group similar FDC entries together:

```python
from sklearn.cluster import HDBSCAN

X = np.vstack(list(fdc_embeddings.values()))
clusterer = HDBSCAN(min_cluster_size=3, metric='cosine')
labels = clusterer.fit_predict(X)

# Cluster 42: [171077, 174036, 175231, ...]  # All ground beef!
```

This also works! But wait — what do you *call* each cluster?

**Month 3: Cluster Naming**

```python
def name_cluster(fdc_ids: list[int]) -> str:
    descriptions = [get_description(id) for id in fdc_ids]
    
    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{
            "role": "system",
            "content": "Generate a short canonical ingredient name for this group."
        }, {
            "role": "user", 
            "content": f"Foods:\n" + "\n".join(descriptions)
        }]
    )
    return response.choices[0].message.content
    
name_cluster([171077, 174036, 175231])
# "Ground Beef"  ← Great!

name_cluster([173467, 173468, 173469])
# "Table Salt"  ← Should this be "salt" or "table salt"?

name_cluster([168411, 168412])
# "Atlantic Salmon Fillet"  ← Too specific? Just "salmon"?
```

Now you're tuning prompts and arguing about granularity.

### 4.3 Where It Falls Apart

**Threshold hell.** Every embedding-based approach requires arbitrary cutoffs:

```python
SIMILARITY_THRESHOLD = 0.75  # Why 0.75? Who knows.
MIN_CLUSTER_SIZE = 3        # Why 3? Seemed reasonable.
```

You spend weeks tuning these. 0.75 groups "ground beef 80%" with "ground beef 90%" ✓ but also groups "beef steak" with "beef roast" ✗. The threshold problem is unsolvable because there's no ground truth.

**Non-determinism.** Same input, different outputs:

```python
canonicalize("Spices, pepper, black")
# Run 1: "black pepper"
# Run 2: "black pepper"  
# Run 3: "ground black pepper"  ← Why?
```

**The semantic trap.** LLMs optimize for semantic correctness:

```python
# The LLM "knows" these are equivalent:
"ground beef" ≈ "minced beef" ≈ "hamburger meat"
```

So when you ask for "the canonical name," the LLM might choose any of these. They're all semantically correct! But for your API, you need ONE answer. The LLM doesn't know that your recipe corpus uses "ground beef" 5,820 times and "minced beef" 47 times.

**Semantic equivalence ≠ Pragmatic canonicalization**

### 4.4 The Sunk Cost Trap

After months of this, you have embeddings infrastructure, clustering pipelines, prompt libraries, evaluation frameworks, and caching layers. The investment makes you reluctant to abandon it.

But the architecture is fundamentally wrong. You're trying to infer something that already exists — explicitly — in recipe data.

### 4.5 Problems Summary

| Issue | Description |
|-------|-------------|
| **Non-deterministic** | Same input can produce different outputs |
| **Expensive** | Embedding + inference costs add up |
| **Opaque** | Why similarity = 0.73? Why this cluster boundary? |
| **Hallucination-prone** | LLM might invent names no one uses |
| **Drift** | Model updates change outputs silently |
| **Threshold sensitivity** | Arbitrary cutoffs with no ground truth |
| **Granularity undefined** | LLM doesn't know what specificity you want |
| **Semantic trap** | Equivalent names are all "correct" |
| **Evaluation circular** | You test against your own assumptions |

---

## 5. The Recipe-First Approach (What We ARE Doing)

### 5.1 Data Source

Recipe corpus: 231,637 recipes with structured ingredient lists.

```csv
id,name,ingredients
38,spaghetti carbonara,"['spaghetti', 'bacon', 'eggs', 'parmesan cheese', 'black pepper']"
```

### 5.2 Extraction

```typescript
const ingredientCounts = new Map<string, number>();

for (const recipe of recipes) {
  for (const ingredient of parseIngredientList(recipe.ingredients)) {
    const normalized = ingredient.toLowerCase().trim();
    ingredientCounts.set(normalized, (ingredientCounts.get(normalized) ?? 0) + 1);
  }
}

// Output: 14,915 unique ingredient names with frequencies
```

### 5.3 Results

| Ingredient | Frequency | Coverage |
|------------|-----------|----------|
| salt | 85,266 | 36.8% of recipes |
| butter | 54,566 | 23.6% |
| sugar | 44,325 | 19.1% |
| eggs | 33,389 | 14.4% |
| olive oil | 32,763 | 14.1% |
| ground beef | 5,820 | 2.5% |

### 5.4 The Canonical IS the Recipe Name

```sql
CREATE TABLE canonical_ingredient (
  canonical_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name   text NOT NULL,          -- "ground beef" (from recipes)
  canonical_slug   text NOT NULL UNIQUE,   -- "ground-beef"
  canonical_rank   bigint NOT NULL,        -- frequency-based priority
  total_count      bigint NOT NULL,        -- 5820
  synthetic_fdc_id bigint UNIQUE           -- 9000042
);

CREATE TABLE canonical_fdc_membership (
  canonical_id       uuid REFERENCES canonical_ingredient(canonical_id),
  fdc_id             bigint REFERENCES foods(fdc_id),
  membership_reason  text NOT NULL,        -- 'canonical_bridge', 'base_bridge'
  PRIMARY KEY (canonical_id, fdc_id)
);
```

The recipe ingredient string **is** the canonical name. No derivation, no inference.

---

## 6. Technical Comparison

| Aspect | LLM Approach | Recipe-First Approach |
|--------|--------------|----------------------|
| **Canonical source** | Model inference | Human consensus (counted) |
| **Determinism** | Non-deterministic | Fully deterministic |
| **Granularity** | Embedding distance threshold | Recipe usage patterns |
| **Validation** | A/B testing, human eval | Frequency counts, coverage |
| **Compute** | GPU inference, embeddings | String matching, SQL |
| **Cost per query** | ~$0.001-0.01 | ~$0.00001 |
| **Explainability** | "The model says..." | "5,820 recipes use this exact string" |
| **Drift** | Model updates change output | Only changes with new recipe data |
| **Edge cases** | Hallucination risk | Explicit frequency = 1 detection |

---

## 7. Why Frequency Matters

Frequency provides natural prioritization and edge case detection:

```
salt           85,266  ← Universal, definitely canonical
ground beef     5,820  ← Common, canonical
truffle oil        35  ← Niche but real
groud beef          2  ← Typo, discarded by frequency floor
```

### Coverage Analysis

| Top N Ingredients | % of Recipe Ingredient Usage |
|-------------------|------------------------------|
| 100 | ~52% |
| 500 | ~77% |
| 1,000 | ~86% |
| 5,000 | ~98% |

Focusing on the top 500 ingredients solves most of the problem.

### Ambiguity Detection

Low-frequency ingredients often indicate:
- Misspellings: "groud beef" (freq=2)
- Regional variants: "minced beef" vs "ground beef"
- Compound ingredients: "garlic butter"

Frequency gives you signal about which names need human review.

---

## 8. Implementation Architecture

```
┌─────────────────────┐
│   Recipe Corpus     │
│   (231K recipes)    │
└──────────┬──────────┘
           │ extract-recipe-ingredients.ts
           ▼
┌─────────────────────┐
│ recipe_ingredient   │
│ _vocab (14,915)     │
└──────────┬──────────┘
           │ map-recipe-ingredients.ts
           ▼
┌─────────────────────────────────────────────┐
│ canonical_ingredient + canonical_fdc_membership │
└──────────┬──────────────────────────────────┘
           │ aggregate-recipe-nutrients.ts
           ▼
┌─────────────────────────────────────────────┐
│ canonical_ingredient_nutrients               │
│ (median, p10, p90, p25, p75, min, max)      │
└─────────────────────────────────────────────┘
```

---

## 9. When LLMs Would Help

LLM approaches might add value for:

1. **Fuzzy matching gaps**: Recipe says "gr beef", no exact FDC match
2. **Compound decomposition**: "garlic butter" → garlic + butter
3. **Quantity normalization**: "2 eggs" → understanding "eggs" is the ingredient
4. **Cross-lingual**: Mapping "carne molida" to "ground beef"

But these are **edge case cleanup**, not the core canonicalization.

The 80/20 is:
- **80%**: Exact string matching from recipe vocabulary
- **20%**: Fuzzy/semantic matching for leftovers

---

## 10. Honest Limitations

### Corpus Bias Becomes Ontology Bias

The canonical string is "what people write" **in your corpus**.

| Corpus | Canonical Form | Frequency |
|--------|----------------|-----------|
| US recipes | "ground beef" | 5,820 |
| UK recipes | "minced beef" | 4,200 |
| Australian | "beef mince" | 3,100 |

Different corpora yield different canonicals. A US-centric corpus produces US-centric naming.

### Frequency is a Prior, Not Truth

Frequency determines:
- ✓ What gets canonicalized first
- ✓ What the *default* name should be

Frequency does NOT determine:
- ✗ Which FDC IDs belong to a canonical
- ✗ State axes (raw/cooked, fresh/frozen)
- ✗ Whether two ingredients are semantically identical

**Example danger:** "sea salt" (freq=2,400) and "salt" (freq=85,000) are both high-frequency. Frequency alone doesn't tell you whether to merge them or keep them separate.

### Portability Strategy

The system supports locale-specific layers and explicit alias bridging:

```sql
-- "minced beef" → canonical "ground beef" for US API users
CREATE TABLE canonical_ingredient_alias (
  canonical_id uuid,
  alias_norm text,
  alias_source text,  -- 'uk-corpus', 'manual-review'
  PRIMARY KEY (canonical_id, alias_norm)
);
```

This keeps the approach honest and prevents critics from dismissing it as US-centric.

---

## 11. Implementation Details

### Data Model

**Extensions required:**

```sql
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Fuzzy matching
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- UUID generation
```

**Core tables:**

```sql
-- Recipe vocabulary (raw corpus data)
CREATE TABLE recipe_ingredient_vocab (
  vocab_id        bigserial PRIMARY KEY,
  ingredient_text text NOT NULL,
  ingredient_norm text NOT NULL,
  count           bigint NOT NULL DEFAULT 0,
  source          text NOT NULL DEFAULT 'food-com',
  UNIQUE (source, ingredient_norm)
);

-- Canonical registry
CREATE TABLE canonical_ingredient (
  canonical_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name   text NOT NULL,
  canonical_slug   text NOT NULL UNIQUE,
  canonical_rank   bigint NOT NULL,
  total_count      bigint NOT NULL,
  synthetic_fdc_id bigint UNIQUE,
  version          text NOT NULL DEFAULT '1.0.0'
);

-- Aliases for regional variants
CREATE TABLE canonical_ingredient_alias (
  canonical_id   uuid REFERENCES canonical_ingredient(canonical_id),
  alias_norm     text NOT NULL,
  alias_count    bigint NOT NULL DEFAULT 0,
  alias_source   text NOT NULL DEFAULT 'corpus',
  PRIMARY KEY (canonical_id, alias_norm)
);

-- FDC membership
CREATE TABLE canonical_fdc_membership (
  canonical_id       uuid REFERENCES canonical_ingredient(canonical_id),
  fdc_id             bigint REFERENCES foods(fdc_id),
  membership_reason  text NOT NULL,
  PRIMARY KEY (canonical_id, fdc_id)
);

-- Nutrient boundaries
CREATE TABLE canonical_ingredient_nutrients (
  canonical_id   uuid REFERENCES canonical_ingredient(canonical_id),
  nutrient_id    bigint REFERENCES nutrients(nutrient_id),
  unit_name      text NOT NULL,
  median         double precision NOT NULL,
  p10            double precision,
  p90            double precision,
  p25            double precision,
  p75            double precision,
  min_amount     double precision,
  max_amount     double precision,
  n_samples      int NOT NULL,
  PRIMARY KEY (canonical_id, nutrient_id)
);
```

### Quantity Stripping Warning

If recipe source includes full lines ("1 lb ground beef"), you must parse and strip quantity/unit **before** counting.

**Do not write your own regex for this.** Recipe writers are chaotic:

| Input | Naive Regex Fails Because |
|-------|---------------------------|
| `1 (14 oz) can tomatoes` | Parentheses break capture groups |
| `Salt and pepper to taste` | No quantity to strip |
| `Three large eggs` | "Three" is text, not digit |
| `1-2 cups flour` | Range syntax |

Use a deterministic NLP parser:
- **Python:** `ingredient-parser` (CRF-based)
- **Node:** `parse-ingredient` or `recipe-ingredient-parser`

### FDC Membership Mapping

```sql
WITH search_terms AS (
  SELECT 'ground beef' AS term
)
SELECT 
  f.fdc_id, 
  f.description,
  similarity(f.description, s.term) as trgm_sim,
  CASE 
    WHEN f.description ILIKE '%' || s.term || '%' THEN 'exact-match'
    ELSE 'fuzzy-match'
  END as match_type
FROM foods f
JOIN fdc_cookability_assessment fca ON fca.fdc_id = f.fdc_id, search_terms s
WHERE
  fca.is_cookable = true
  AND (
    f.description ILIKE '%' || s.term || '%'
    OR similarity(f.description, s.term) > 0.4
  )
ORDER BY 
  (f.description ILIKE '%' || s.term || '%') DESC,
  trgm_sim DESC
LIMIT 50;
```

---

## 12. Implementation Status

All components are complete:

1. **`recipe_ingredient_vocab`** — 231K recipes, 14,915 unique ingredients
2. **`canonical_ingredient`** — frequency-ranked registry
3. **`canonical_ingredient_alias`** — regional variants and synonyms
4. **`canonical_fdc_membership`** — FDC foods mapped via canonical/base bridge
5. **`canonical_ingredient_nutrients`** — median, p10/p90, p25/p75, min/max boundaries

**API endpoints:**
- `GET /api/ingredients` — paginated list with search
- `GET /api/ingredients/:slug` — detail with nutrient boundaries
- `POST /api/ingredients/resolve` — batch resolve free-text names with `method` + `confidence`

---

## 13. Conclusion

| Approach | Philosophy |
|----------|------------|
| **LLM-based** | "What *should* we call this, based on semantic understanding?" |
| **Recipe-first** | "What *do* people call this, based on actual usage?" |

The recipe-first approach trades semantic sophistication for empirical grounding. It's not smarter — it's more literal. And for building a practical nutrition API, literal is exactly what we need.

The wisdom of 231,637 recipe authors, distilled into 14,915 strings with frequency counts, is a better ontology than any model could infer.

---

## Appendix: Synthetic FDC ID Ranges

| Range | Purpose |
|-------|---------|
| 9,000,000–9,099,999 | Recipe-derived canonical ingredients |
| 9,100,000–9,199,999 | Non-food items (tools, equipment) |
| 9,200,000–9,299,999 | Legacy canonical aggregates (deprecated) |

