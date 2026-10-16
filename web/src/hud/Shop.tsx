import { ITEMS, type Item, PODIUM_COINS, type Slot } from "@tokenmaxxing/core/shop.ts";
import type { Look } from "@tokenmaxxing/core/world.ts";
import { useEffect, useRef, useState } from "react";
import { PET_H, PET_W, petFrame } from "../art/pets.ts";
import { refreshMe, town } from "../net.ts";
import { hud, useHud } from "../store.ts";
import { AvatarImage, Modal, Pills, useRun } from "./ui.tsx";

const TABS = [
  ["outfit", "Clothes"],
  ["glasses", "Glasses"],
  ["hat", "Hats"],
  ["pet", "Pets"],
] as const;

const PLACES = ["🥇", "🥈", "🥉"];

export function Shop() {
  const me = useHud((s) => s.me);
  const wallet = useHud((s) => s.wallet);
  const [tab, setTab] = useState<Slot>("outfit");
  const { error, run } = useRun();
  useEffect(() => {
    void town.wallet().then((w) => hud.set({ wallet: w }));
  }, []);
  if (!me || !wallet) return <Modal title="🪙 Shop">Loading…</Modal>;

  const wear = async (look: Look) => {
    await town.setLook(look);
    await refreshMe();
  };
  const buy = (item: Item) =>
    run(async () => {
      hud.set({ wallet: await town.buy(item.id) });
      await wear({ ...me.look, [item.slot]: item.index });
    });

  return (
    <Modal title="🪙 Shop" wide>
      <p className="wallet">
        <strong>🪙 {wallet.balance.toLocaleString()}</strong> coins
        <span className="muted"> · +{wallet.today} from today so far</span>
      </p>
      <p className="muted small">
        Every day you earn √(tokens ÷ 1M) coins: 100M tokens is 10, 1B is 31. Finish a day 1st, 2nd or 3rd for{" "}
        {PODIUM_COINS.join(", ")} more.
        {wallet.wins.length > 0 &&
          ` Lately: ${wallet.wins
            .slice(0, 5)
            .map((w) => `${PLACES[w.place - 1]} ${w.day.slice(5)}`)
            .join(" ")}`}
      </p>
      <Pills value={tab} options={TABS} onChange={setTab} />
      <ul className="shop">
        {ITEMS.filter((i) => i.slot === tab).map((item) => {
          const owned = wallet.owned.includes(item.id);
          const wearing = me.look[item.slot] === item.index;
          return (
            <li key={item.id} className={wearing ? "wearing" : undefined}>
              {item.slot === "pet" ? (
                <PetImage pet={item.index} />
              ) : (
                <AvatarImage look={{ ...me.look, [item.slot]: item.index }} scale={4} />
              )}
              <span>{item.name}</span>
              {wearing ? (
                <button type="button" onClick={run(() => wear({ ...me.look, [item.slot]: 0 }))}>
                  Take off
                </button>
              ) : owned ? (
                <button type="button" onClick={run(() => wear({ ...me.look, [item.slot]: item.index }))}>
                  Wear
                </button>
              ) : item.level !== undefined ? (
                <button type="button" disabled>
                  🔒 Lv {item.level}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={wallet.balance < item.price}
                  onClick={buy(item)}
                >
                  🪙 {item.price}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function PetImage({ pet, scale = 4 }: { pet: number; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    const frame = petFrame(pet, false, false);
    if (!g || !frame) return;
    g.imageSmoothingEnabled = false;
    g.drawImage(frame, ((16 - PET_W) / 2) * scale, (16 - PET_H) * scale, PET_W * scale, PET_H * scale);
  }, [pet, scale]);
  return <canvas ref={ref} width={16 * scale} height={16 * scale} className="avatar" />;
}
