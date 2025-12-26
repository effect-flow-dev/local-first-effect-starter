import { signal } from "@preact/signals-core";
import { v4 as uuidv4 } from "uuid";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

export const toastsState = signal<Toast[]>([]);

export const addToast = (
  message: string,
  type: ToastType = "info",
  duration = 5000
) => {
  const id = uuidv4();
  const newToast: Toast = { id, message, type, duration };
  
  toastsState.value = [...toastsState.value, newToast];

  if (duration > 0) {
    setTimeout(() => {
      removeToast(id);
    }, duration);
  }
};

export const removeToast = (id: string) => {
  toastsState.value = toastsState.value.filter((t) => t.id !== id);
};
