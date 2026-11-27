import { Monitor, Moon, Sun } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { buttonClass } from "./button.tsx";
import { Menu, MenuRadioItem } from "./menu.tsx";

export type ThemePreference = "light" | "dark" | "system";

/**
 * 主题记在本机浏览器的这个键下面。apps/web/index.html 里有一小段在第一次绘制之前就运行的
 * 内联脚本，读的也是它：两处必须同名，改这里就要改那里。
 */
export const THEME_STORAGE_KEY = "nexus-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 存下来的值认不出来，或者从来没存过，就跟随系统。 */
export function parsePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** 三种选择落到实际用哪套配色：深色就是在 <html> 上加 dark 类（决策记录 0004 第 10 条）。 */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // 隐私模式、被禁的存储：读不到就当没存过，跟随系统。
    return null;
  }
}

function writeStored(value: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // 存不下来只在这一次有效，刷新后回到系统配色。不影响使用。
  }
}

/** 系统此刻是不是深色。跟着系统的设置变，所以一直听着。 */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const update = (): void => setDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return dark;
}

/**
 * 主题的来处：浅色、深色、跟随系统，记在本机浏览器里，换标签页、关了再开都还在。
 * 第一次绘制之前的样子由 index.html 的内联脚本先定好，这里接手之后的结果和它一样，所以不闪。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() =>
    parsePreference(readStored()),
  );
  const systemDark = useSystemDark();

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      resolveTheme(preference, systemDark) === "dark",
    );
  }, [preference, systemDark]);

  useEffect(() => {
    writeStored(preference);
  }, [preference]);

  // 另一个标签页里换了主题，这边跟着换。
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === THEME_STORAGE_KEY) setPreference(parsePreference(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, setPreference }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme 要放在 ThemeProvider 里面");
  return value;
}

interface ThemeOption {
  value: ThemePreference;
  label: string;
  icon: ComponentType;
}

const SYSTEM_OPTION = { value: "system", label: "跟随系统", icon: Monitor } as const;

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  SYSTEM_OPTION,
];

/** 主题切换按钮：图标是此刻用的那一档，点开是三个选项，当前的那项打勾。 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const current = THEME_OPTIONS.find((option) => option.value === preference) ?? SYSTEM_OPTION;
  const CurrentIcon = current.icon;
  return (
    <Menu
      label="主题"
      align="end"
      trigger={(props) => (
        <button
          {...props}
          className={buttonClass({ variant: "ghost", size: "icon" }, className)}
          aria-label={`主题：${current.label}`}
          title={`主题：${current.label}`}
        >
          <CurrentIcon />
        </button>
      )}
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <MenuRadioItem
          key={value}
          icon={<Icon />}
          checked={value === preference}
          onSelect={() => setPreference(value)}
        >
          {label}
        </MenuRadioItem>
      ))}
    </Menu>
  );
}
