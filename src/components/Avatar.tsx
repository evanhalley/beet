export interface AvatarProps {
  login: string;
  size?: number;
  accent?: boolean;
}

const HUES = [355, 25, 75, 145, 200, 240, 280, 320];

export function Avatar({ login, size = 18, accent = false }: AvatarProps) {
  let h = 0;
  for (let i = 0; i < login.length; i++) h = (h * 31 + login.charCodeAt(i)) >>> 0;
  const hue = HUES[h % HUES.length];
  const ch = login[0]?.toUpperCase() ?? "?";
  const ch2 = login[1]?.toUpperCase() ?? "";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        background: accent ? "var(--color-accent)" : `oklch(0.66 0.12 ${hue})`,
        color: "#fff",
        fontSize: size * 0.46,
        fontWeight: 600,
        letterSpacing: -0.3,
        flexShrink: 0,
      }}
    >
      {ch}
      {size > 22 ? ch2 : ""}
    </span>
  );
}
