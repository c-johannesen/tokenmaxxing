import { MAPS } from "@tokenmaxxing/core/maps.ts";
import { FURNITURE, OFFICE_PIECES, type Placed, parseOffice, pieceOf } from "@tokenmaxxing/core/office.ts";
import { useEffect, useState } from "react";
import { town } from "../net.ts";
import { Modal, Pills, useRun } from "./ui.tsx";

/**
 * My office's editor, from my bag: a piece goes down only if the bag has one left, and one picked up
 * or thrown out with ✕ is back in it. Changes stay here until Save; the world keeps drawing the saved
 * office until then.
 * It opens with E facing a wall, or from the menu: nobody can face the door, a step goes through it.
 */
export function OfficePanel() {
  const [saved, setSaved] = useState<{ furniture: Placed[]; open: boolean } | null>(null);
  const [held, setHeld] = useState<Map<string, number> | null>(null);
  const [list, setList] = useState<Placed[]>([]);
  const [tool, setTool] = useState<string>(FURNITURE[0]!.ch);
  const { error, busy, run } = useRun();
  useEffect(() => {
    void town.office().then((o) => {
      setSaved(o);
      setList(o.furniture);
    });
    void town.bag().then((b) => setHeld(new Map(b.map((r) => [r.item, r.count]))));
  }, []);
  if (!saved || !held) return <Modal title="🛋 Your office">Loading…</Modal>;

  // A new office's desk and chair are rows from its first save (or sync at level 10): never below 0.
  const left = (ch: string) =>
    Math.max(0, (held.get(`furn.${ch}`) ?? 0) - list.filter((p) => p.ch === ch).length);
  const tools = [
    ...FURNITURE.map((f) => [f.ch, `${f.name} ×${left(f.ch)}`] as const),
    ["", "✕ Remove"] as const,
  ];
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
    if (tool && left(tool) > 0 && parseOffice(next)) setList(next);
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
        <Pills value={tool} options={tools} onChange={setTool} />
      </div>
      <div
        className="plot-grid small"
        style={{ gridTemplateColumns: `repeat(${MAPS.office.width - 2}, 4.5em)`, gridAutoRows: "3em" }}
      >
        {MAPS.office.find("_").map(([x, y]) => {
          // A wide piece's name on its own tile only, so two side by side read as two.
          const here = at(x, y);
          const name = pieceOf(here?.ch)?.name;
          return (
            <button
              key={`${x},${y}`}
              type="button"
              className="plot-free"
              aria-pressed={!!name}
              aria-label={name ?? "Empty floor"}
              onClick={() => click(x, y)}
            >
              {here?.x === x ? name : name && "·"}
            </button>
          );
        })}
      </div>
      <p className="wallet">
        <span className="muted">
          {list.length}/{OFFICE_PIECES} pieces{" "}
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={run(async () => {
            await town.setOffice(list);
            setSaved({ ...saved, furniture: list });
          })}
        >
          Save
        </button>
        {tool && left(tool) === 0 && <span className="muted"> None left in your bag</span>}
      </p>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
