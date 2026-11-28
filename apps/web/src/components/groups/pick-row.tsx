import { Button, ItemAvatar, StatusBadge } from "@nexus/ui-kit";
import { useState, type ReactNode } from "react";

export interface PickRowProps {
  /** 行首头像里的字。 */
  letter: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** 标题后面的状态小标（比如「已停用」）。 */
  badge?: ReactNode;
  /** 行尾那个按钮的字：加选的行是「加入」，已在的行是「移出」。 */
  actionLabel: string;
  /** 做的时候按钮的字。 */
  busyLabel?: string;
  onAction: () => Promise<void>;
}

/**
 * 加选清单里的一行（成员管理、可见的工程共用）：头像、两行字、一个行尾按钮。
 * 不做拖拽画布——那是旧系统的形态；加入和移出都是点一下，整份集合由页面整体替换着提交
 * （规格 G-28）。提交在途时按钮锁住、字换成「正在…」，不让人以为没点上。
 */
export function PickRow({
  letter,
  title,
  subtitle,
  badge,
  actionLabel,
  busyLabel = "正在改…",
  onAction,
}: PickRowProps) {
  const [pending, setPending] = useState(false);

  const act = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      await onAction();
    } finally {
      setPending(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-control px-3 py-2">
      <ItemAvatar letter={letter} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-foreground">
          <span className="truncate">{title}</span>
          {badge}
        </div>
        {subtitle !== undefined ? (
          <div className="truncate text-caption text-ink-3">{subtitle}</div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void act()}
        className="shrink-0"
      >
        {pending ? busyLabel : actionLabel}
      </Button>
    </li>
  );
}

/** 名录里查不到的人：建过工程的删不掉、名录只列启用（规格 G-07、G-21），那就是已停用。 */
export function DisabledBadge() {
  return (
    <StatusBadge tone="warn" className="shrink-0">
      已停用
    </StatusBadge>
  );
}
