"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { addFillComment, completeFillTask, saveFillAnswers, uploadFillFile } from "@/lib/actions/form-external";
import { TaskWindow, type TaskWindowActions } from "@/components/forms/task-window";
import type { TaskWindowData } from "@/lib/forms/types";

/** Builds the task window actions for an outside person. The token and task id stay in this closure. */
export function FillTask({ token, data }: { token: string; data: TaskWindowData }) {
  const router = useRouter();
  const taskId = data.task.id;
  const actions = useMemo<TaskWindowActions>(() => ({
    save: async (patch) => {
      const r = await saveFillAnswers(token, taskId, patch);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    complete: async () => {
      const r = await completeFillTask(token, taskId);
      if (r.ok) router.refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    comment: async (form) => {
      const r = await addFillComment(token, taskId, form);
      if (r.ok) router.refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    upload: async (fieldKey, form) => {
      form.set("fieldKey", fieldKey);
      const r = await uploadFillFile(token, taskId, form);
      return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.error };
    },
  }), [token, taskId, router]);

  return <TaskWindow data={data} mode="external" actions={actions} />;
}
