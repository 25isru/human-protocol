import report from "../../data/validation_report.json";
import { registry } from "../registry";
import type { ValidationReport } from "../validation/gates";
import { groupLabel } from "./explain";

const data = report as ValidationReport;

function fmt(x: number, unit: string) {
  return unit === "%" ? `${x.toFixed(1)}%` : `${x.toFixed(1)} ${unit}`;
}

export function Accuracy() {
  const stale = data.registry_version !== registry.version;
  const checked = data.traits.filter((t) => t.gates.some((g) => g.id === "marginal" && g.status !== "skip"));
  return (
    <section className="accuracy">
      <h2>How accurate is it?</h2>
      <p>
        To check the generator, {data.people.toLocaleString("en")} people were rolled and counted. Each group in that simulated
        population was then compared with the published figure it was built from. A trait is only allowed on the site if every check passes.
      </p>
      <p className={`verdict${data.summary.failed ? " is-bad" : ""}`}>
        {data.summary.failed ? `${data.summary.failed} of ${data.summary.traits} traits are failing a check.` : "Every trait passes every check."}
      </p>
      {stale && <p className="error">The trait data has changed since this report was generated.</p>}
      <p className="note">This shows that the generator reproduces its sources faithfully. It cannot show that the sources themselves are right, or cover links between traits that are not modelled yet.</p>

      {checked.map((t) => {
        const spec = registry.traits.get(t.id)!;
        return (
          <article className="acc-trait" key={t.id}>
            <h3>{t.label}</h3>
            <ul className="gates">
              {t.gates.filter((g) => g.status !== "skip").map((g) => (
                <li key={g.id} className={`gate gate-${g.status}`}>
                  <span className="gate-mark" aria-hidden="true">{g.status === "pass" ? "✓" : "✗"}</span>
                  <span><strong>{g.name}.</strong> {g.detail}.</span>
                </li>
              ))}
            </ul>
            {t.examples.length > 0 && (
              <table>
                <thead><tr><th>Group</th><th>Measure</th><th>Source</th><th>Simulated</th></tr></thead>
                <tbody>
                  {t.examples.map((e, i) => (
                    <tr key={i}>
                      <td>{Object.keys(e.stratum).length ? groupLabel(e.stratum, registry) : "everyone"}</td>
                      <td>{e.what === "yes" ? "share" : e.what === "average" ? "average" : t.id === "frame.country" ? registry.geo[e.what]?.name ?? e.what : spec.category_labels?.[e.what] ?? (t.id === "frame.age" ? `age ${e.what}` : e.what)}</td>
                      <td className="num">{fmt(e.expected, e.unit)}</td>
                      <td className="num">{fmt(e.simulated, e.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        );
      })}
    </section>
  );
}
