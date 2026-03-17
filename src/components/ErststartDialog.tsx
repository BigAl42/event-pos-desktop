import { useState } from "react";
import { setupMaster, setupSlave } from "../db";
import "./ErststartDialog.css";

type Props = { onDone: () => void };

export default function ErststartDialog({ onDone }: Props) {
  const [step, setStep] = useState<"choice" | "master" | "slave">("choice");
  const [name, setName] = useState("");
  const [person1, setPerson1] = useState("");
  const [person2, setPerson2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleMaster() {
    if (!name.trim()) {
      setError("Bitte Kassenname angeben.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await setupMaster(name.trim(), person1.trim(), person2.trim());
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSlave() {
    if (!name.trim()) {
      setError("Bitte Kassenname angeben.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await setupSlave(name.trim(), person1.trim(), person2.trim());
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (step === "choice") {
    return (
      <div className="erststart">
        <div className="erststart-card">
          <h1>Kassensystem einrichten</h1>
          <p>Als was möchten Sie diese Kasse einrichten?</p>
          <div className="erststart-buttons">
            <button type="button" onClick={() => setStep("master")}>
              Als Hauptkasse
            </button>
            <button type="button" onClick={() => setStep("slave")}>
              Netz beitreten (Nebenkasse)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isMaster = step === "master";
  return (
    <div className="erststart">
      <div className="erststart-card">
        <h1>{isMaster ? "Hauptkasse einrichten" : "Netz beitreten"}</h1>
        <p>Kassenname und die beiden Personen am Platz angeben.</p>
        <div className="erststart-form">
          <label>
            Kassenname (z. B. Stand 1)
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Stand 1"
            />
          </label>
          <label>
            Person 1
            <input
              type="text"
              value={person1}
              onChange={(e) => setPerson1(e.target.value)}
              placeholder="Name"
            />
          </label>
          <label>
            Person 2
            <input
              type="text"
              value={person2}
              onChange={(e) => setPerson2(e.target.value)}
              placeholder="Name"
            />
          </label>
        </div>
        {error && <p className="erststart-error">{error}</p>}
        <div className="erststart-actions">
          <button type="button" onClick={() => setStep("choice")}>
            Zurück
          </button>
          <button
            type="button"
            onClick={isMaster ? handleMaster : handleSlave}
            disabled={loading}
          >
            {loading ? "…" : isMaster ? "Als Hauptkasse einrichten" : "Einrichtung abschließen"}
          </button>
        </div>
      </div>
    </div>
  );
}
