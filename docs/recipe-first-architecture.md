# Recipe-First Canonical Naming: A Non-LLM Approach to Ingredient Identity

> **TL;DR:** Instead of using machine learning to infer what "ground beef" means, we count how many times real recipe authors wrote "ground beef" and use that as the canonical form. The wisdom of crowds replaces the wisdom of weights.

**Methodology:** [Empirical Ontology for High-Stakes Domains](empirical-ontology-pattern.md)

---

## 0. The Architectural Unlock

This approach treats **language as data, not as semantics**.

| Data Source | What It Tells You | Role |
|-------------|-------------------|------|
| **USDA/FDC** | What a molecule is | Chemistry database |
| **Recipe Corpus** | What a human *thinks* food is | Cultural database |
| **This System** | The bridge between them | Ontology layer |

By relying on frequency distributions (Zipf's law acts as your garbage collector), we let the "wisdom of the crowd" perform categorization work that inference tools do poorly and expensively.

**The key insight:** 99% of "AI Nutrition" projects try to solve an *ontology* problem with *inference* tools. They're using hammers on screws.

---

## 1. The Problem: What Should We Call This Food?

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

This is fundamentally a **naming and grouping problem**.

---

## 2. Approach Evolution

### 2.1 Phase 1: Regex-Based Extraction (FDC-First)

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

### 2.2 Phase 2: Container Categories and Domain Rules

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

### 2.3 Phase 3: Recipe-First (Current)

**Key insight:** Recipe ingredient lists already solved this problem.

Real recipes contain ingredient names written by humans for humans:
- "1 lb ground beef"
- "2 cups flour"
- "1 tsp salt"

These names represent **consensus** — thousands of independent authors converging on the same strings.

---

## 3. The LLM Approach (What We're NOT Doing)

This section documents the typical LLM-first approach in detail — not as a strawman, but because **this is exactly what most engineers (including the author) attempt first**. It feels like the obviously correct approach. It isn't.

### 3.1 The Intuition That Leads You Astray

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

### 3.2 The Typical LLM-First Pipeline

**Month 1: Embeddings**

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

# Embed all FDC descriptions
fdc_embeddings = {}
for food in fdc_foods:
    fdc_embeddings[food.fdc_id] = model.encode(food.description)

# Now you can find similar foods!
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

You realize you need to group similar FDC entries together. Embeddings to the rescue:

```python
from sklearn.cluster import HDBSCAN
import numpy as np

# Stack all embeddings
X = np.vstack(list(fdc_embeddings.values()))

# Cluster
clusterer = HDBSCAN(min_cluster_size=3, metric='cosine')
labels = clusterer.fit_predict(X)

# Now each cluster represents a "canonical ingredient"
clusters = defaultdict(list)
for fdc_id, label in zip(fdc_embeddings.keys(), labels):
    clusters[label].append(fdc_id)

# Cluster 42: [171077, 174036, 175231, ...]  # All ground beef!
```

This also works! But wait — what do you call each cluster?

**Month 3: Cluster Naming**

```python
def name_cluster(fdc_ids: list[int]) -> str:
    descriptions = [get_description(id) for id in fdc_ids]
    
    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{
            "role": "system",
            "content": "Generate a short canonical ingredient name for this group of foods."
        }, {
            "role": "user", 
            "content": f"Foods:\n" + "\n".join(descriptions)
        }]
    )
    return response.choices[0].message.content
    
name_cluster([171077, 174036, 175231])
# "Ground Beef"  ← Great!

name_cluster([173467, 173468, 173469])
# "Table Salt"  ← Hmm, should this be "salt" or "table salt"?

name_cluster([168411, 168412])
# "Atlantic Salmon Fillet"  ← Too specific? Just "salmon"?
```

Now you're tuning prompts and arguing about granularity.

### 3.3 The Threshold Hell

Every embedding-based approach requires thresholds:

```python
# When are two foods "the same ingredient"?
SIMILARITY_THRESHOLD = 0.75  # Why 0.75? Who knows.

# HDBSCAN parameters
MIN_CLUSTER_SIZE = 3        # Why 3? Seemed reasonable.
MIN_SAMPLES = 2             # Trial and error.
CLUSTER_SELECTION_EPSILON = 0.1  # More trial and error.
```

You spend weeks tuning these:

- 0.75 similarity groups "ground beef 80%" with "ground beef 90%" ✓
- But it also groups "beef steak" with "beef roast" ✗
- Lower to 0.80? Now ground beef variants are separate ✗
- Add special rules for beef? Getting hacky...

**The threshold problem is unsolvable** because there's no ground truth. You're trying to learn a boundary that you can't define.

### 3.4 The LLM Canonicalization Attempt

Eventually you try direct LLM canonicalization:

```python
def canonicalize(description: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{
            "role": "system",
            "content": """Convert FDC food descriptions to canonical ingredient names.
            
Rules:
- Use common cooking terminology
- Remove preparation details (raw, cooked)
- Remove brand names
- Use singular form
- Be concise

Examples:
"Beef, ground, 80% lean meat / 20% fat, raw" → "ground beef"
"Chicken, broilers or fryers, breast, meat only, raw" → "chicken breast"
"""
        }, {
            "role": "user",
            "content": description
        }]
    )
    return response.choices[0].message.content
```

This works surprisingly well for common cases. But:

```python
canonicalize("Spices, pepper, black")
# Run 1: "black pepper"
# Run 2: "black pepper"  
# Run 3: "ground black pepper"  ← Wait, why?

canonicalize("Fish, salmon, Atlantic, wild, raw")
# Run 1: "wild Atlantic salmon"
# Run 2: "Atlantic salmon"
# Run 3: "salmon"  ← Which is canonical?
```

**Non-determinism kills you.** Same input, different outputs. Your database becomes inconsistent.

### 3.5 The Consistency Patch

You add caching and determinism hacks:

```python
import hashlib

CANONICAL_CACHE = {}

def canonicalize_deterministic(description: str) -> str:
    cache_key = hashlib.md5(description.encode()).hexdigest()
    
    if cache_key in CANONICAL_CACHE:
        return CANONICAL_CACHE[cache_key]
    
    # Call LLM with temperature=0
    response = openai.chat.completions.create(
        model="gpt-4",
        temperature=0,  # Deterministic!
        messages=[...]
    )
    
    result = response.choices[0].message.content
    CANONICAL_CACHE[cache_key] = result
    
    # Persist cache to avoid re-computation
    save_cache()
    
    return result
```

Now you have:
- A cache that's the real source of truth
- An LLM that generates once, then is ignored
- Cache invalidation problems when you update prompts
- No way to know if the LLM would give a better answer now

### 3.6 The Granularity Problem

The LLM doesn't know what granularity you want:

```python
# Is this one ingredient or multiple?
"Beef, ground, 80% lean meat / 20% fat, raw"
"Beef, ground, 90% lean meat / 10% fat, raw"

# LLM might say:
# - "ground beef" (grouped)
# - "ground beef 80/20" and "ground beef 90/10" (separate)
# - "lean ground beef" and "extra lean ground beef" (different grouping)
```

You add more prompt engineering:

```python
SYSTEM_PROMPT = """
...
Granularity rules:
- Group different fat percentages of ground beef together
- Keep different cuts of steak separate (ribeye vs sirloin)
- Treat different fish species as separate ingredients
- But group different preparations of the same fish together
...
"""
```

**Your prompt becomes a domain ontology** — hundreds of lines of rules. At this point, you're not using the LLM for understanding. You're using it as a fuzzy rule executor. Why not just write deterministic rules?

### 3.7 The Cost Spiral

Running GPT-4 on 8,000 FDC descriptions:

```
8,000 descriptions × ~100 tokens each = 800,000 input tokens
8,000 responses × ~10 tokens each = 80,000 output tokens

GPT-4 pricing (2024):
- Input: $0.03/1K tokens → $24
- Output: $0.06/1K tokens → $4.80
- Total: ~$30 per full run

Need to iterate on prompts? 10 iterations = $300
Need to update periodically? $30/month
Need to reprocess for new FDC data? Another $30
```

It's not catastrophic, but it adds up. And every dollar spent makes you more reluctant to iterate.

### 3.8 The Evaluation Problem

How do you know if your LLM canonicalization is good?

```python
# You create test cases
test_cases = [
    ("Beef, ground, 80% lean meat / 20% fat, raw", "ground beef"),
    ("Chicken, broilers or fryers, breast, meat only, raw", "chicken breast"),
    # ... 50 more
]

# Run evaluation
correct = 0
for input, expected in test_cases:
    result = canonicalize(input)
    if result.lower() == expected.lower():
        correct += 1
        
accuracy = correct / len(test_cases)
# 92% accuracy! 
```

But wait:
- Who decided the expected values?
- Why is "ground beef" correct and not "hamburger meat"?
- The test cases encode YOUR assumptions
- You're grading the LLM on your own biases

**You have no external ground truth.**

### 3.9 The Semantic Trap

The fundamental problem: LLMs optimize for semantic correctness.

```python
# The LLM "knows" these are equivalent:
"ground beef" ≈ "minced beef" ≈ "hamburger meat"
"bell pepper" ≈ "sweet pepper" ≈ "capsicum"
"eggplant" ≈ "aubergine"
```

So when you ask for "the canonical name," the LLM might choose any of these. They're all semantically correct!

But for your API, you need ONE answer. Which one? The LLM doesn't know your users. It doesn't know that your recipe corpus uses "ground beef" 5,820 times and "minced beef" 47 times.

**Semantic equivalence ≠ Pragmatic canonicalization**

### 3.10 The Sunk Cost Fallacy

After months of this:
- You have embeddings infrastructure
- You have clustering pipelines
- You have prompt libraries
- You have evaluation frameworks
- You have caching layers

The investment makes you reluctant to abandon it. "We've come this far, let's just tune it more."

But the architecture is fundamentally wrong. You're trying to infer something that already exists — explicitly — in recipe data.

### 3.11 Problems Summary

| Issue | Description |
|-------|-------------|
| **Non-deterministic** | Same input can produce different outputs across runs |
| **Expensive** | Embedding 8,000+ descriptions, inference costs |
| **Opaque** | Why did similarity = 0.73? Why this cluster boundary? |
| **Hallucination-prone** | LLM might invent canonical names that no one uses |
| **Drift** | Model updates change outputs without code changes |
| **Threshold sensitivity** | cosine_sim > 0.7? 0.75? 0.8? Arbitrary cutoffs |
| **No ground truth** | "Correct" is defined by the model's training, not by domain experts |
| **Granularity undefined** | LLM doesn't know what level of specificity you want |
| **Semantic trap** | Equivalent names are all "correct" but you need consistency |
| **Cost spiral** | Iteration becomes expensive, discouraging improvement |
| **Evaluation circular** | You test against your own assumptions |

---

## 4. The Human-Data Approach (What We ARE Doing)

### 4.1 Data Source

Recipe corpus: 231,637 recipes with structured ingredient lists.

```csv
# RAW_recipes.csv
id,name,ingredients
38,spaghetti carbonara,"['spaghetti', 'bacon', 'eggs', 'parmesan cheese', 'black pepper']"
...
```

### 4.2 Extraction

```typescript
// scripts/extract-recipe-ingredients.ts
const ingredientCounts = new Map<string, number>();

for (const recipe of recipes) {
  for (const ingredient of parseIngredientList(recipe.ingredients)) {
    const normalized = ingredient.toLowerCase().trim();
    ingredientCounts.set(normalized, (ingredientCounts.get(normalized) ?? 0) + 1);
  }
}

// Output: 14,915 unique ingredient names with frequencies
```

### 4.3 Results

| Ingredient | Frequency | Source |
|------------|-----------|--------|
| salt | 85,127 | 231,637 recipes, 36.8% usage |
| butter | 41,623 | 18.0% of recipes |
| sugar | 39,108 | 16.9% |
| eggs | 34,729 | 15.0% |
| ground beef | 5,820 | 2.5% |
| olive oil | 28,442 | 12.3% |

### 4.4 Mapping to FDC

```sql
-- Exact phrase match
SELECT fdc_id, description 
FROM foods 
WHERE lower(description) LIKE '%ground beef%'
  AND is_cookable = true;

-- Results:
-- 171077: "Beef, ground, 80% lean meat / 20% fat, raw"
-- 174036: "Beef, ground, 85% lean meat / 15% fat, raw"
-- ...
```

### 4.5 The Canonical IS the Recipe Name

```sql
CREATE TABLE recipe_ingredient_mapping (
  ingredient_name TEXT PRIMARY KEY,  -- "ground beef" (from recipes)
  ingredient_slug TEXT NOT NULL,     -- "ground-beef"
  frequency INT NOT NULL,            -- 5820
  fdc_ids BIGINT[] NOT NULL,         -- [171077, 174036, ...]
  synthetic_fdc_id BIGINT            -- 9200042 (our synthetic ID)
);
```

The recipe ingredient string **is** the canonical name. No derivation, no inference.

---

## 5. Technical Comparison

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

## 6. Why Frequency Matters

Frequency provides natural prioritization and edge case detection:

```
salt           85,127  ← Universal, definitely canonical
ground beef     5,820  ← Common, canonical
truffle oil       127  ← Niche but real
ghost pepper       23  ← Rare specialty
beef fat            3  ← Edge case, manual review
```

### 6.1 Coverage Analysis

| Top N Ingredients | % of Recipe Ingredient Usage |
|-------------------|------------------------------|
| 100 | ~60% |
| 500 | ~85% |
| 1,000 | ~92% |
| 5,000 | ~99% |

Focusing on the top 500 ingredients solves most of the problem.

### 6.2 Ambiguity Detection

Low-frequency ingredients often indicate:
- Misspellings: "groud beef" (freq=2)
- Regional variants: "minced beef" vs "ground beef"
- Compound ingredients: "garlic butter" (should map to butter + garlic?)

Frequency gives you signal about which names need human review.

---

## 7. Implementation Architecture

```
┌─────────────────────┐
│   Recipe Corpus     │
│   (231K recipes)    │
└──────────┬──────────┘
           │ extract-recipe-ingredients.ts
           ▼
┌─────────────────────┐
│ Ingredient Vocab    │
│ (14,915 unique)     │
│ with frequencies    │
└──────────┬──────────┘
           │ map-recipe-ingredients.ts
           ▼
┌─────────────────────────────────────────┐
│ recipe_ingredient_mapping               │
│ ┌─────────────┬───────┬───────────────┐ │
│ │ ingredient  │ freq  │ fdc_ids       │ │
│ ├─────────────┼───────┼───────────────┤ │
│ │ ground beef │ 5820  │ [171077, ...] │ │
│ │ salt        │ 85127 │ [173467, ...] │ │
│ └─────────────┴───────┴───────────────┘ │
└──────────┬──────────────────────────────┘
           │ aggregate-synthetic-nutrients.ts
           ▼
┌─────────────────────────────────────────┐
│ synthetic_ingredient_nutrients          │
│ ┌─────────────┬────────┬───────┬──────┐ │
│ │ ingredient  │ median │ p10   │ p90  │ │
│ ├─────────────┼────────┼───────┼──────┤ │
│ │ ground beef │ 254cal │ 176   │ 332  │ │
│ └─────────────┴────────┴───────┴──────┘ │
└─────────────────────────────────────────┘
```

---

## 8. The Anti-Pattern: Semantic Understanding

LLMs excel at semantic understanding. This problem doesn't need it.

Consider:
- "ground beef" and "minced beef" are semantically equivalent
- An LLM would (correctly) identify them as the same thing
- But in a US recipe corpus, "ground beef" appears 5,820 times and "minced beef" appears 47 times

**The LLM is semantically right but pragmatically wrong.**

For a nutrition API serving recipe apps, "ground beef" is the canonical form because that's what recipe authors actually write. The semantic equivalence is irrelevant — we're building an index, not a thesaurus.

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

## 10. Bias, Portability, and Honest Limitations

The recipe-first approach has a critical limitation that must be acknowledged:

### 10.1 Corpus Bias Becomes Ontology Bias

The canonical string is "what people write" **in your corpus**.

| Corpus | Canonical Form | Frequency |
|--------|----------------|-----------|
| US recipes | "ground beef" | 5,820 |
| UK recipes | "minced beef" | 4,200 |
| Australian | "beef mince" | 3,100 |

Different corpora yield different canonicals. A US-centric corpus produces US-centric naming.

### 10.2 Frequency is a Prior, Not Truth

Frequency determines:
- ✓ What gets canonicalized first
- ✓ What gets attention first
- ✓ What the *default* name should be

Frequency does NOT determine:
- ✗ Which FDC IDs belong to a canonical
- ✗ State axes (raw/cooked, fresh/frozen)
- ✗ Whether two ingredients are semantically identical

**Example danger:** "sea salt" (freq=2,400) and "salt" (freq=85,000) are both high-frequency. Frequency alone doesn't tell you whether to merge them or keep them separate.

### 10.3 Portability Strategy

The system must support:

1. **Locale-specific canonical layers**
   ```sql
   -- Same FDC foods, different canonical names by locale
   canonical_ingredient_locale (
     canonical_id uuid,
     locale text,  -- 'en-US', 'en-GB', 'en-AU'
     localized_name text,
     primary key (canonical_id, locale)
   )
   ```

2. **Alias bridging across corpora**
   ```sql
   -- "minced beef" → canonical "ground beef" for US API users
   -- Explicit, reviewable, not inferred
   canonical_ingredient_alias (
     canonical_id uuid,
     alias_norm text,
     alias_source text,  -- 'uk-corpus', 'manual-review'
     primary key (canonical_id, alias_norm)
   )
   ```

This keeps the approach honest and prevents critics from dismissing it as US-centric.

---

## 11. Implementation Contract

This section defines the operational rules that prevent the two failure modes:
1. Corpus bias becoming unchecked ontology bias
2. String frequency becoming "truth"

### 11.1 Data Model

**Extensions required:**

```sql
-- Essential for fuzzy matching
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

**Recipe ingredient vocabulary (raw)**

```sql
create table recipe_ingredient_vocab (
  vocab_id bigserial primary key,
  ingredient_text text not null,         -- "1 large egg" (raw, for debugging)
  ingredient_norm text not null,         -- "egg" (parsed & normalized)
  source text not null default 'unknown', -- 'us-corpus-2024', 'user-submitted'
  count bigint not null default 1,
  
  -- Parser metadata (optional but valuable)
  parsed_quantity text,                  -- "1"
  parsed_unit text,                      -- "large"
  
  updated_at timestamptz not null default now(),
  unique (source, ingredient_norm)
);

create index idx_vocab_count_desc on recipe_ingredient_vocab (count desc);
create index idx_vocab_norm_trgm on recipe_ingredient_vocab using gin (ingredient_norm gin_trgm_ops);
```

**Canonical ingredient registry**

```sql
create table canonical_ingredient (
  canonical_id uuid primary key default uuid_generate_v4(),
  canonical_name text not null,          -- "ground beef"
  canonical_slug text not null unique,   -- "ground-beef"
  frequency_rank bigint,                 -- 1 = most common
  total_usage_count bigint not null default 0,
  created_at timestamptz not null default now(),
  version text not null default '1.0.0'
);
```

**Canonical aliases (critical for bias control)**

```sql
create table canonical_ingredient_alias (
  canonical_id uuid references canonical_ingredient(canonical_id) on delete cascade,
  alias_norm text not null,
  alias_count bigint not null default 0,
  alias_source text not null default 'auto-generated', -- 'auto-generated', 'manual-override'
  confidence_score float default 1.0,    -- 1.0 = exact, <1.0 = fuzzy/inferred
  primary key (canonical_id, alias_norm)
);

create index idx_alias_trgm on canonical_ingredient_alias using gin (alias_norm gin_trgm_ops);
```

**FDC membership**

```sql
create table canonical_fdc_membership (
  canonical_id uuid references canonical_ingredient(canonical_id) on delete cascade,
  fdc_id bigint references foods(fdc_id) on delete cascade,
  membership_reason text not null,       -- 'exact-match', 'token-match', 'manual'
  weight double precision not null default 1.0,
  primary key (canonical_id, fdc_id)
);
```

**Synthetic nutrient boundaries**

```sql
create table synthetic_ingredient_nutrients (
  canonical_id uuid references canonical_ingredient(canonical_id) on delete cascade,
  nutrient_id bigint not null,
  amount_median double precision,
  amount_p10 double precision,
  amount_p90 double precision,
  sample_size int,
  updated_at timestamptz default now(),
  primary key (canonical_id, nutrient_id)
);
```

### 11.2 Normalization Rules

`ingredient_norm` is deterministic:

1. Lowercase
2. Trim whitespace
3. Collapse internal whitespace
4. Normalize unicode (NFKC)
5. Strip trailing punctuation

**No synonym folding at this stage.** Folding happens explicitly via aliases.

### 11.3 Quantity Stripping (Critical Warning)

If recipe source includes full lines ("1 lb ground beef"), you must parse and strip quantity/unit **before** counting.

**WARNING: Do not write your own regex for this.**

Recipe writers are chaotic agents of entropy:

| Input | Naive Regex Fails Because |
|-------|---------------------------|
| `1 (14 oz) can tomatoes` | Parentheses break capture groups |
| `Salt and pepper to taste` | No quantity to strip |
| `Three large eggs` | "Three" is text, not digit |
| `1-2 cups flour` | Range syntax |
| `1/2 cup milk` | Fraction handling |

**The Fix (Without LLMs):**

Use a deterministic NLP parser specifically trained for recipes:

- **Python:** `ingredient-parser` (CRF-based)
- **Node:** `parse-ingredient` or `recipe-ingredient-parser`

These handle edge cases using Conditional Random Fields or complex rule sets — much safer than regex.

```typescript
// DON'T do this:
function stripQuantity(line: string): string {
  return line.replace(/^\d+(\.\d+)?\s*(cups?|tbsp?|tsp?|oz|lb)\s*/i, '').trim();
}

// DO use a proper parser:
import { parseIngredient } from 'parse-ingredient';

function extractIngredientName(line: string): string {
  const parsed = parseIngredient(line);
  return parsed.ingredient;  // Handles "1 (14 oz) can tomatoes" → "tomatoes"
}
```

### 11.4 Canonical Selection Rule

**Step 1: Filter by frequency**
- Keep top N by count (e.g., 5,000), OR
- Keep those above threshold (e.g., count ≥ 25)

**Step 2: Canonical = most frequent representative within a group**
- Grouping is defined by explicit aliases, not by similarity inference
- If no aliases exist, each unique `ingredient_norm` is its own canonical

### 11.5 Aliasing Strategy (Non-LLM, Corpus-Driven)

Aliases are discovered but **not auto-merged**.

**Discovery signals:**

| Signal | Method | Example |
|--------|--------|---------|
| Trigram similarity | `similarity(a, b) >= 0.8` | "ground beef" ~ "grnd beef" |
| Edit distance | Levenshtein ≤ 2 for short words | "salt" ~ "salf" |
| Mutual exclusivity | Never appear in same recipe/locale | "ground beef" vs "minced beef" |
| Shared FDC hits | Both map to same top FDC candidates | Both → [171077, 174036, ...] |

**Merge rule (conservative):**
> Merge alias → canonical only when BOTH mutual exclusivity AND shared FDC hits hold.

Everything else stays separate for manual review.

### 11.6 FDC Membership Mapping

For each `canonical_name`:

1. Filter: `is_cookable = true`
2. Match priority:
   - **Exact substring match**: Fast, high confidence
   - **Trigram similarity**: Catches typos and word order variations
   - **Token set match**: All canonical tokens present in description
3. Return top K candidates (e.g., 50)
4. Store accepted memberships with `membership_reason`

**PostgreSQL implementation:**

```sql
-- Find FDC candidates for a canonical ingredient
WITH search_terms AS (
  SELECT 'ground beef' AS term  -- Input from your loop
)
SELECT 
  f.fdc_id, 
  f.description,
  similarity(f.description, s.term) as trgm_sim,
  CASE 
    WHEN f.description ILIKE '%' || s.term || '%' THEN 'exact-match'
    ELSE 'fuzzy-match'
  END as match_type
FROM foods f, search_terms s
WHERE 
  -- Must be cookable
  f.is_cookable = true 
  AND (
    -- Exact substring match (fastest)
    f.description ILIKE '%' || s.term || '%'
    OR
    -- High fuzzy similarity (catches typos/word order)
    similarity(f.description, s.term) > 0.4
  )
ORDER BY 
  -- Prioritize exact matches, then high similarity
  (f.description ILIKE '%' || s.term || '%') DESC,
  trgm_sim DESC
LIMIT 50;
```

If no matches found, leave membership empty (flagged for review).

### 11.7 Synthetic Nutrient Boundaries

For each `canonical_id` with members:

```sql
insert into synthetic_ingredient_nutrients
select
  canonical_id,
  nutrient_id,
  percentile_cont(0.5) within group (order by amount) as median,
  percentile_cont(0.1) within group (order by amount) as p10,
  percentile_cont(0.9) within group (order by amount) as p90,
  count(*) as n_samples
from canonical_fdc_membership m
join food_nutrients fn on m.fdc_id = fn.fdc_id
group by canonical_id, nutrient_id;
```

### 11.8 Versioning Requirements

| Entity | Version Field | Bump When |
|--------|---------------|-----------|
| Canonical ingredient | `version` | Canonical name changes |
| Membership | `membership_reason` | FDC mapping rules change |
| Nutrient aggregation | Recompute on member change | Members added/removed |

**Never silently overwrite without version bump.**

---

## 12. Immediate Implementation Steps

1. **Create `recipe_ingredient_vocab`** — load whatever corpus exists (even 2K generated recipes)
2. **Generate top 1,000 canonical candidates** — frequency-sorted
3. **Build FDC canonical base names** — if not already done via `food_canonical_names`
4. **Map top 200 canonicals to FDC membership** — exact + token matching
5. **Generate synthetic nutrient boundaries** — median, p10, p90
6. **Expose API**:
   - `GET /api/canonical-ingredients` — list with frequency
   - `GET /api/canonical-ingredients/:slug` — detail with nutrients and sources

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
