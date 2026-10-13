import { Toaster as Sonner } from "sonner";
import { useLang } from "@/lib/lang";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // The toast region's name is read out by screen readers ("Notifications alt+T" stayed English, QA S-29).
  const { t } = useLang();
  return (
    <Sonner
      className="toaster group"
      containerAriaLabel={t("Notifications")}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
