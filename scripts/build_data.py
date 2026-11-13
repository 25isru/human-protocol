#!/usr/bin/env python3
"""Builds data/traits/*.json and data/geo.json from the raw source datasets.

Usage: python3 scripts/build_data.py <dir with wpp2024, owid-datasets, wcde-data clones>

Sources (see data/sources.json for full citations):
  wpp2024        github.com/PPgp/wpp2024          UN World Population Prospects 2024
  owid-datasets  github.com/owid/owid-datasets    NCD-RisC height, IHME smoking, UN WUP 2018
  wcde-data      github.com/guyabel/wcde-data     Wittgenstein Centre education projections v3
"""
import json, math, re, sys, unicodedata
from collections import defaultdict
from pathlib import Path
import pandas as pd, pyreadr, pycountry

EXT = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "data"
AS_OF = 2026
r4 = lambda x: float(f"{x:.4g}")

# ---------- geography ----------
u = pd.read_csv(EXT / "wpp2024/data/UNlocations.txt", sep="\t")
u = u[u.location_type == 4]
geo = {}
for _, r in u.iterrows():
    code = str(int(r.country_code))
    pc = pycountry.countries.get(numeric=f"{int(r.country_code):03d}")
    geo[code] = {"name": r["name"], "iso2": pc.alpha_2 if pc else None,
                 "subregion": r.reg_name if isinstance(r.reg_name, str) else r.area_name, "region": r.area_name}

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", "", s)
    return re.sub(r"[^a-z]", "", s.replace("&", "and"))

name2code = {norm(v["name"]): k for k, v in geo.items()}
ALIASES = {
    "United States": "840", "Russia": "643", "Iran": "364", "South Korea": "410", "North Korea": "408",
    "Vietnam": "704", "Laos": "418", "Syria": "760", "Tanzania": "834", "Bolivia": "68", "Venezuela": "862",
    "Moldova": "498", "Brunei": "96", "Cape Verde": "132", "Czech Republic": "203", "Czechia": "203",
    "Democratic Republic of Congo": "180", "Congo": "178", "Cote d'Ivoire": "384", "Swaziland": "748",
    "Eswatini": "748", "Macedonia": "807", "North Macedonia": "807", "Micronesia (country)": "583",
    "Micronesia": "583", "Palestine": "275", "Timor": "626", "East Timor": "626", "Turkey": "792",
    "Hong Kong": "344", "Macao": "446", "Taiwan": "158", "Curacao": "531", "Reunion": "638",
    "Saint Barthlemy": "652", "Faeroe Islands": "234", "Falkland Islands": "238", "Sint Maarten (Dutch part)": "534",
    "Saint Martin (French part)": "663", "Bonaire Sint Eustatius and Saba": "535", "Wallis and Futuna": "876",
    "United States Virgin Islands": "850", "Micronesia (Fed. States of)": "583", "Kosovo": "412",
    "The Bahamas": "44", "Bahamas": "44", "The Gambia": "270", "Gambia": "270", "Saint Helena": "654",
}
def code_of(name):
    c = ALIASES.get(name) or name2code.get(norm(name))
    return c if c in geo else None

# ---------- population frame (UN WPP 2024, medium projection) ----------
p = pyreadr.read_r(str(EXT / "wpp2024/data/popprojAge1dt.rda"))["popprojAge1dt"]
p = p[(p.year.astype(int) == AS_OF) & (p.country_code.astype(str).isin(geo))]
pop = {}        # (code, sex) -> [101 ages], thousands
for (cc,), g in p.groupby(["country_code"]):
    g = g.sort_values("age")
    pop[(str(cc), "male")] = g.popM.tolist()
    pop[(str(cc), "female")] = g.popF.tolist()
dropped = sorted(geo[c]["name"] for c in geo if (c, "male") not in pop)
print("  [frame] no age data, dropped:", dropped)
geo = {c: v for c, v in geo.items() if (c, "male") in pop}
codes = sorted(geo, key=lambda c: geo[c]["name"])
tot = {c: sum(pop[(c, "male")]) + sum(pop[(c, "female")]) for c in codes}
world = sum(tot.values())

def hier(c):
    return [c, "S:" + geo[c]["subregion"], "R:" + geo[c]["region"], "W"]

def aggregate(rows, weight):
    """rows: {(code, *rest): [numbers]} -> adds subregion/region/world weighted means."""
    acc = defaultdict(lambda: [None, 0.0])
    for (c, *rest), vals in rows.items():
        w = weight(c, *rest)
        if w <= 0: continue
        for h in hier(c)[1:]:
            a = acc[(h, *rest)]
            a[0] = [w * v for v in vals] if a[0] is None else [x + w * v for x, v in zip(a[0], vals)]
            a[1] += w
    out = dict(rows)
    for k, (s, w) in acc.items():
        out[k] = [x / w for x in s]
    return out

def table(rows, digits=4):
    return {"|".join(k): [float(f"{v:.{digits}g}") for v in vals] for k, vals in sorted(rows.items())}

def write(spec):
    (OUT / "traits" / f"{spec['id']}.json").write_text(json.dumps(spec, separators=(",", ":")))
    print(f"{spec['id']:28s} rows={len(spec.get('baseline', {}).get('table', {}))}")

SEXES = ["male", "female"]
def sexpop(c, sex, lo=0, hi=101): return sum(pop[(c, sex)][lo:hi])

# frame.country
write({"id": "frame.country", "version": 1, "label": "Country of residence", "tier": 0,
       "definition": f"Country or area of residence in {AS_OF}, drawn in proportion to its population.",
       "value_type": "categorical", "categories": codes, "parents": [],
       "baseline": {"keys": [], "backoff": [], "dist_kind": "categorical",
                    "table": {"": [float(f"{tot[c] / world:.6g}") for c in codes]}},
       "modifiers": [], "ref_year": AS_OF, "source_ids": ["un_wpp_2024"], "grade": "A",
       "notes": ["Uses the UN medium-variant projection for 2026, since estimates end in 2023."]})

# frame.sex | country
write({"id": "frame.sex", "version": 1, "label": "Sex", "tier": 0,
       "definition": "Sex as recorded in population statistics (male or female).",
       "value_type": "categorical", "categories": SEXES, "parents": ["frame.country"],
       "baseline": {"keys": ["frame.country"], "backoff": [], "dist_kind": "categorical",
                    "table": table({(c,): [sexpop(c, "male") / tot[c], sexpop(c, "female") / tot[c]] for c in codes})},
       "modifiers": [], "ref_year": AS_OF, "source_ids": ["un_wpp_2024"], "grade": "A",
       "notes": ["Population statistics record two sexes; intersex and gender identity are not modelled yet."]})

# frame.age | country, sex
write({"id": "frame.age", "version": 1, "label": "Age", "tier": 0, "unit": "years",
       "definition": "Age in completed years. 100 means 100 or older.",
       "value_type": "categorical", "categories": [str(a) for a in range(101)], "numeric": True,
       "parents": ["frame.country", "frame.sex"],
       "baseline": {"keys": ["frame.country", "frame.sex"], "backoff": [], "dist_kind": "categorical",
                    "table": table({(c, s): [v / sexpop(c, s) for v in pop[(c, s)]] for c in codes for s in SEXES}, 3)},
       "modifiers": [], "ref_year": AS_OF, "source_ids": ["un_wpp_2024"], "grade": "A", "notes": []})

# derived traits
AGE5 = [f"{a}--{a+4}" for a in range(0, 100, 5)] + ["100+"]
for spec in [
    {"id": "frame.birth_year", "label": "Birth year", "tier": 0, "definition": f"{AS_OF} minus age.",
     "value_type": "derived", "parents": ["frame.age"], "derive": {"fn": "birth_year", "as_of": AS_OF}},
    {"id": "frame.age_group", "label": "Age group", "tier": 0, "definition": "Five-year age group.", "hidden": True,
     "value_type": "derived", "parents": ["frame.age"], "derive": {"fn": "age_group5"}},
    {"id": "frame.birth_cohort", "label": "Birth cohort", "tier": 0, "definition": "Five-year birth cohort.", "hidden": True,
     "value_type": "derived", "parents": ["frame.birth_year"], "derive": {"fn": "cohort5"}},
    {"id": "geo.subregion", "label": "Subregion", "tier": 1, "definition": "UN M49 subregion of the country.",
     "value_type": "derived", "parents": ["frame.country"], "derive": {"fn": "geo", "field": "subregion"}},
    {"id": "geo.region", "label": "Region", "tier": 1, "definition": "UN M49 region of the country.",
     "value_type": "derived", "parents": ["frame.country"], "derive": {"fn": "geo", "field": "region"}},
]:
    write({**spec, "version": 1, "modifiers": [], "source_ids": ["un_wpp_2024"] if spec["id"].startswith("geo") else [],
           "grade": "A", "notes": []})

OW = EXT / "owid-datasets/datasets"
def owid(folder):
    d = OW / folder
    return pd.read_csv(next(d.glob("*.csv")))
def report_unmatched(label, names):
    miss = sorted({n for n in names if code_of(n) is None})
    print(f"  [{label}] unmatched entities ({len(miss)}): {miss}")

# origin.setting | country   (UN WUP 2018)
w = owid("Urban and rural population 1950-2050 - UN World Urbanization Prospects 2018")
w = w[w.Year == AS_OF]; w.columns = ["entity", "year", "urban", "rural"]
report_unmatched("urban", w.entity)
rows = {}
for _, r in w.iterrows():
    c = code_of(r.entity)
    if c and r.urban + r.rural > 0:
        rows[(c,)] = [r.urban / (r.urban + r.rural), r.rural / (r.urban + r.rural)]
rows = aggregate(rows, lambda c: tot[c])
write({"id": "origin.setting", "version": 1, "label": "Lives in", "tier": 1,
       "definition": "Urban or rural residence, using each country's own definition of urban.",
       "value_type": "categorical", "categories": ["urban", "rural"], "parents": ["frame.country"],
       "phrases": {"urban": "lives in a town or city", "rural": "lives in the countryside"},
       "baseline": {"keys": ["frame.country"], "backoff": [{"key": "frame.country", "via": "geo_hierarchy"}],
                    "dist_kind": "categorical", "table": table(rows)},
       "modifiers": [], "ref_year": AS_OF, "source_ids": ["un_wup_2018"], "grade": "A",
       "notes": ["Projected in 2018 for 2026.", "Not yet conditioned on age or sex.",
                 "Countries define 'urban' differently, so the label is not strictly comparable across borders."]})

# body.height_cm | country, sex, birth cohort   (NCD-RisC 2016/2017)
h = owid("Human Height - NCD RisC (2017)").iloc[:, :4]
h.columns = ["entity", "year", "male", "female"]
report_unmatched("height", h.entity)
SD = {"male": 7.0, "female": 6.5}
acc = defaultdict(list)
for _, r in h.iterrows():
    c = code_of(r.entity)
    if not c: continue
    cohort = str(int(r.year) // 5 * 5)
    for s in SEXES:
        if not math.isnan(r[s]): acc[(c, s, cohort)].append(r[s])
rows = {k: [sum(v) / len(v)] for k, v in acc.items()}
rows = aggregate(rows, lambda c, s, co: sexpop(c, s))
rows = {k: [v[0], SD[k[1]]] for k, v in rows.items()}
cohorts = sorted({k[2] for k in rows}, key=int)
write({"id": "body.height_cm", "version": 1, "label": "Height", "tier": 3, "unit": "cm",
       "definition": "Standing adult height.",
       "value_type": "continuous", "support": {"min": 120, "max": 215},
       "phrases": {"*": "is {value} cm tall"},
       "applies_when": {"trait": "frame.age", "op": "gte", "value": 18},
       "parents": ["frame.country", "frame.sex", "frame.birth_cohort"],
       "baseline": {"keys": ["frame.country", "frame.sex", "frame.birth_cohort"],
                    "backoff": [{"key": "frame.birth_cohort", "via": "nearest", "order": cohorts},
                                {"key": "frame.country", "via": "geo_hierarchy"}],
                    "dist_kind": "normal", "table": table(rows, 5)},
       "modifiers": [], "ref_year": 2016, "source_ids": ["ncd_risc_height_2016", "dhs_height_sd_2018"], "grade": "A",
       "assumptions": [{"what": "Standard deviation of 7.0 cm for men and 6.5 cm for women in every country and cohort",
                        "why": "The source publishes mean height only. Measured within-country spreads are typically 6 to 7 cm, "
                               "and a 59-country survey analysis found country-level values for women from 5.2 to 11.8 cm.",
                        "grade": "D"}],
       "notes": ["Means cover birth years 1896 to 1996. People born later use the most recent cohort.",
                 "Regional fallbacks are population-weighted averages of the countries with data.",
                 "Shrinkage of height in old age is not modelled."]})

# social.education | country, sex, age group   (Wittgenstein Centre v3, SSP2, 2025)
EDU = ["No Education", "Incomplete Primary", "Primary", "Lower Secondary", "Upper Secondary", "Post Secondary"]
e = pyreadr.read_r(str(EXT / "wcde-data/wcde-v3-batch/2/pop-age-sex-edattain.rds"))[None]
e = e[(e.year == 2025) & e.education.isin(EDU) & ~e.age.isin(["0--4", "5--9", "10--14"])]
e["code"] = e.country_code.astype(int).astype(str)
e = e[e.code.isin(geo)]
rows = {}
for (c, s, a), g in e.groupby(["code", "sex", "age"]):
    v = g.set_index("education")["pop"].reindex(EDU).fillna(0).tolist()
    if sum(v) > 0: rows[(c, s.lower(), a)] = v           # keep counts for exact aggregation
print(f"  [education] countries: {len({k[0] for k in rows})}, missing: {sorted(geo[c]['name'] for c in set(geo) - {k[0] for k in rows})}")
rows = aggregate(rows, lambda c, s, a: 1.0)
rows = {k: [x / sum(v) for x in v] for k, v in rows.items() if sum(v) > 0}
write({"id": "social.education", "version": 1, "label": "Education", "tier": 4,
       "definition": "Highest level of education completed so far.",
       "value_type": "ordinal", "categories": EDU,
       "phrases": {"No Education": "has no formal education", "Incomplete Primary": "left school during primary",
                   "Primary": "finished primary school", "Lower Secondary": "finished lower secondary school",
                   "Upper Secondary": "finished upper secondary school", "Post Secondary": "has a post-secondary or university education"},
       "category_labels": {"No Education": "No formal education", "Incomplete Primary": "Some primary school",
                           "Primary": "Primary school", "Lower Secondary": "Lower secondary school",
                           "Upper Secondary": "Upper secondary school", "Post Secondary": "Post-secondary or university"},
       "applies_when": {"trait": "frame.age", "op": "gte", "value": 15},
       "parents": ["frame.country", "frame.sex", "frame.age_group"],
       "baseline": {"keys": ["frame.country", "frame.sex", "frame.age_group"],
                    "backoff": [{"key": "frame.country", "via": "geo_hierarchy"}],
                    "dist_kind": "categorical", "table": table(rows, 3)},
       "modifiers": [], "ref_year": 2025, "source_ids": ["wic_2023"], "grade": "A",
       "notes": ["Medium (SSP2) scenario for 2025, reconstructed from censuses and surveys.",
                 "People aged 15 to 24 may still be studying, so this is attainment to date.",
                 "Not yet linked to urban or rural residence."]})

# health.smoker_daily | country, sex   (IHME 2012)
s = owid("Smoking prevalence and cigarette consumption (IHME, GHDx (2012))")
s = s[s.Year == 2012]
mcol = [c for c in s.columns if c.startswith("Daily smoking prevalence - male")][0]
fcol = [c for c in s.columns if c.startswith("Daily smoking prevalence - female")][0]
report_unmatched("smoking", s.Entity)
rows = {}
for _, r in s.iterrows():
    c = code_of(r.Entity)
    if not c: continue
    for sex, col in (("male", mcol), ("female", fcol)):
        if not math.isnan(r[col]): rows[(c, sex)] = [r[col] / 100]
rows = aggregate(rows, lambda c, sx: sexpop(c, sx, 15))
write({"id": "health.smoker_daily", "version": 1, "label": "Smokes daily", "tier": 5,
       "definition": "Smokes tobacco every day.",
       "value_type": "boolean", "applies_when": {"trait": "frame.age", "op": "gte", "value": 15},
       "phrases": {"true": "smokes daily", "false": "doesn't smoke daily"},
       "parents": ["frame.country", "frame.sex"],
       "baseline": {"keys": ["frame.country", "frame.sex"],
                    "backoff": [{"key": "frame.country", "via": "geo_hierarchy"}],
                    "dist_kind": "bernoulli", "table": table(rows)},
       "modifiers": [], "ref_year": 2012, "source_ids": ["ihme_smoking_2012"], "grade": "B", "low_confidence": True,
       "notes": ["Figures are for 2012 and smoking has fallen in many countries since.",
                 "One rate per country and sex is applied to everyone aged 15 and over; differences by age are not modelled yet."]})

# body.handedness   (meta-analyses)
write({"id": "body.left_handed", "version": 1, "label": "Left-handed", "tier": 3,
       "definition": "Prefers the left hand for writing and similar tasks.",
       "value_type": "boolean", "parents": ["frame.sex"],
       "phrases": {"true": "is left-handed", "false": "is right-handed"},
       "baseline": {"keys": [], "backoff": [], "dist_kind": "bernoulli", "table": {"": [0.106]}},
       "calibration_offset": 0,
       "modifiers": [{"id": "male", "when": {"trait": "frame.sex", "op": "eq", "value": "male"},
                      "effect": {"kind": "log_odds", "beta": round(math.log(1.23), 4)},
                      "ci95": [round(math.log(1.19), 4), round(math.log(1.27), 4)],
                      "mechanism": "unknown", "source_ids": ["handedness_sex_2008"], "grade": "A",
                      "rationale": "Across 144 studies, men had 1.23 times the odds of being left-handed compared with women."}],
       "ref_year": 2020, "source_ids": ["handedness_meta_2020"], "grade": "A",
       "notes": ["One worldwide rate. The source reports that the rate varies by region and is lower where "
                 "left-hand use is discouraged; that variation is not modelled yet."]})

# identity.sexual_orientation | sex   (Ipsos 2023, 30-country averages as stated in the report text)
ORI = ["straight", "gay_lesbian", "bisexual", "pansexual", "asexual"]
write({"id": "identity.sexual_orientation", "version": 1, "label": "Sexual orientation", "tier": 6,
       "definition": "How the person describes their own sexual orientation in an anonymous survey.",
       "value_type": "categorical", "categories": ORI, "tags": ["sensitive"],
       "category_labels": {"straight": "Straight (or did not say otherwise)", "gay_lesbian": "Gay or lesbian",
                           "bisexual": "Bisexual", "pansexual": "Pansexual", "asexual": "Asexual"},
       "phrases": {"straight": "is straight", "gay_lesbian": "is {gay_word}", "bisexual": "is bisexual",
                   "pansexual": "is pansexual", "asexual": "is asexual"},
       "applies_when": {"trait": "frame.age", "op": "gte", "value": 18},
       "parents": ["frame.sex"],
       "baseline": {"keys": ["frame.sex"], "backoff": [], "dist_kind": "categorical",
                    "table": {"male": [0.90, 0.04, 0.04, 0.01, 0.01], "female": [0.93, 0.01, 0.04, 0.01, 0.01]}},
       "modifiers": [], "ref_year": 2023, "source_ids": ["ipsos_pride_2023"], "grade": "C", "low_confidence": True,
       "notes": ["Based on averages across 30 countries in an online survey: 3% gay or lesbian (4% of men, 1% of women), "
                 "4% bisexual, 1% pansexual and 1% asexual. Everyone else, including people who preferred not to say, is counted as straight.",
                 "The same rates are used for every country and age. The survey found large differences between countries and "
                 "much higher rates among younger adults; those are not modelled yet.",
                 "This measures what people say about themselves. Where being open is unsafe, fewer people say it."]})

(OUT / "geo.json").write_text(json.dumps(geo, separators=(",", ":"), ensure_ascii=False))
print("countries:", len(geo))
