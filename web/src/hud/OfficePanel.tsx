import { MAPS } from "@tokenmaxxing/core/maps.ts";
import {
  FURNITURE,
  OFFICE_PIECES,
  officeCost,
  type Placed,
  parseOffice,
  pieceOf,
} from "@tokenmaxxing/core/office.ts";
import { useEffect, useState } from "react";
import { world } from "../game/world.ts";
import { town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { Modal, Pills, useRun } from "./ui.tsx";

/** Every piece with its price, and ✕ for throwing things out. */
const TOOLS = [
  ...FURNITURE.map((f) => [f.ch, `${f.name} 🪙 ${f.price}`] as const),
  ["", "✕ Remove"] as const,
];

/**
 * My office's editor. Changes stay here until Save, which pays for every piece there's more of;
 * the world keeps drawing the saved office until then.
 * It opens with E facing a wall, or from the menu: nobody can face the door, a step goes through it.
 */
export function OfficePanel() {
  const wallet = useHud((s) => s.wallet);
  const [saved, setSaved] = useState<{ furniture: Placed[]; open: boolean } | null>(null);
  const [list, setList] = useState<Placed[]>([]);
  const [tool, setTool] = useState<string>(FURNITURE[0]!.ch);
  const { error, busy, run } = useRun();
  useEffect(() => {
    void town.office(world.selfId).then((o) => {
      setSaved(o);
      setList(o.furniture);
    });
  }, []);
  if (!saved || !wallet) return <Modal title="🛋 Your office">Loading…</Modal>;

  const cost = officeCost(saved.furniture, list);
  const at = (x: number, y: number) =>
    list.find((p) => p.y === y && x >= p.x && x < p.x + (pieceOf(p.ch)?.w ?? 1));
  // A placed piece is picked up (free to put down again), or thrown out with ✕.
  const click = (x: number, y: number) => {
    const here = at(x, y);
    if (here) {
      setList(list.filter((p) => p !== here));
      if (tool) setTool(here.ch);
      return;
    }
    const next = [...list, { ch: tool, x, y }];
    if (tool && parseOffice(next)) setList(next);
  };

  return (
    <Modal title="🛋 Your office" wide>
      <p>
        <button
          type="button"
          onClick={run(async () => {
            await town.setOfficeOpen(!saved.open);
            setSaved({ ...saved, open: !saved.open });
          })}
        >
          {saved.open ? "🔓 Open to visitors" : "🔒 Closed"}
        </button>
        <span className="muted small">
          {" "}
          {saved.open ? "Anyone can visit from your player card." : "Only you get in, through the door."}
        </span>
      </p>
      <div className="office-tools">
        <Pills value={tool} options={TOOLS} onChange={setTool} />
      </div>
      <div
        className="plot-grid small"
        style={{ gridTemplateColumns: `repeat(${MAPS.office.width - 2}, 4.5em)`, gridAutoRows: "3em" }}
      >
        {MAPS.office.find("_").map(([x, y]) => {
          const name = pieceOf(at(x, y)?.ch)?.name;
          return (
            <button
              key={`${x},${y}`}
              type="button"
              className="plot-free"
              aria-pressed={!!name}
              aria-label={name ?? "Empty floor"}
              onClick={() => click(x, y)}
            >
              {name}
            </button>
          );
        })}
      </div>
      <p className="wallet">
        Costs 🪙 {cost} · you have 🪙 {wallet.balance.toLocaleString()}
        <span className="muted">
          {" "}
          · {list.length}/{OFFICE_PIECES} pieces{" "}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || cost > wallet.balance}
          onClick={run(async () => {
            hud.set({ wallet: await town.setOffice(list) });
            setSaved({ ...saved, furniture: list });
          })}
        >
          Save
        </button>
      </p>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
