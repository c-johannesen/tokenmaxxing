import { itemById } from "@tokenmaxxing/core/shop.ts";
import type { BagRow } from "@tokenmaxxing/server/registry";
import { useEffect, useState } from "react";
import { world } from "../game/world.ts";
import { refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { ItemImage, WearButton } from "./Shop.tsx";
import { Modal, useRun } from "./ui.tsx";

/**
 * What I hold, one square per kind with how many. Picking one shows its name, Wear, and Drop (onto
 * the floor where I am: in my own office, that's furnishing it). 🏅 is a level reward: it stays with me.
 */
export function Bag() {
  const me = useHud((s) => s.me);
  const inMyOffice = useHud((s) => s.room === `office:${world.selfId}`);
  const [bag, setBag] = useState<BagRow[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { error, run } = useRun();
  useEffect(() => {
    void town.bag().then(setBag);
  }, []);
  if (!me || !bag) return <Modal title="🎒 Bag">Loading…</Modal>;

  const drop = (item: string) =>
    run(async () => {
      setNotice(null); // a refused one shows only its error
      setNotice((await town.drop(item)).notice);
      setBag(await town.bag());
      hud.set({ wallet: await town.wallet() }); // the count on 🎒
      await refreshMe(); // a worn one comes off
    });
  // The last one dropped leaves nothing picked.
  const item = bag.some((b) => b.item === picked) ? itemById(picked!) : undefined;

  return (
    <Modal title="🎒 Bag" wide>
      {bag.length === 0 ? (
        <p className="muted">
          Nothing yet.{" "}
          <button type="button" className="link" onClick={() => hud.set({ panel: { kind: "shop" } })}>
            🪙 Shop
          </button>
        </p>
      ) : (
        <div className="bag-pick">
          {item ? (
            <>
              <strong>
                {!item.tradeable && "🏅 "}
                {item.name}
              </strong>
              <WearButton item={item} look={me.look} run={run} />
              {item.tradeable && (
                <button type="button" onClick={drop(item.id)}>
                  {inMyOffice ? "Drop here" : "Drop"}
                </button>
              )}
            </>
          ) : (
            <span className="muted">Pick something to wear it or drop it.</span>
          )}
        </div>
      )}
      {notice && <p className="muted">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <ul className="bag">
        {bag.map((b) => {
          const it = itemById(b.item);
          if (!it) return null;
          const wearing = it.slot !== "furniture" && me.look[it.slot] === it.index;
          return (
            <li key={b.item}>
              <button
                type="button"
                className={wearing ? "cell wearing" : "cell"}
                aria-pressed={b.item === picked}
                aria-label={`${it.name} ×${b.count}`}
                title={it.name}
                onClick={() => setPicked(b.item)}
              >
                <ItemImage item={it} look={me.look} bare />
                {!it.tradeable && <span className="medal">🏅</span>}
                {b.count > 1 && <span className="n">×{b.count}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
