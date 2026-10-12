import React, { useState } from "react";
import {
  CheckSquare,
  Square,
  MinusSquare,
  Trash2,
  FolderInput,
  Download,
  Copy,
  Check,
  FileSpreadsheet,
  FileJson,
  X,
  AlertTriangle,
  FolderKanban,
  Plus,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  Layers,
  Sparkles,
} from "lucide-react";
import {
  LeadProject,
  ExportableLead,
  exportLeadsToCSV,
  exportLeadsToJSON,
  copyLeadsForSheets,
  loadUserProspects,
  saveUserProspects,
  loadProjectHuntedResults,
  saveProjectHuntedResults,
  saveProjects,
} from "@/lib/projects";

/**
 * Extracts a clean domain for display and unique keying
 */
export function extractCleanDomain(urlOrEmail?: string): string {
  if (!urlOrEmail) return "";
  let raw = String(urlOrEmail).trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("@") && !raw.startsWith("http")) {
    raw = raw.split("@").pop() || "";
  }
  raw = raw.replace(/^[a-z]+:\/\//i, "");
  raw = raw.replace(/^www\./i, "");
  raw = raw.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  return raw.trim();
}

/**
 * Generates a stable unique key for an asset/lead
 */
export function getLeadAssetKey(lead: ExportableLead, fallbackIdx?: number): string {
  if (lead.id !== undefined && lead.id !== null && String(lead.id).trim() !== "") {
    return `id_${lead.id}`;
  }
  const name = String(lead.businessName || "").trim().toLowerCase();
  const domain = extractCleanDomain(lead.website) || extractCleanDomain(lead.email) || "";
  const phone = String(lead.phone || "").replace(/\D/g, "");
  return `biz_${name}_${domain}_${phone}_${fallbackIdx ?? ""}`;
}

/**
 * Bulk move leads from their source projects into targetProjectId
 */
export function moveLeadsBetweenProjects(
  targetKeys: Set<string>,
  targetProjectId: string,
  targetProjectName: string,
  allProjects: LeadProject[]
): { movedCount: number; updatedProspects: ExportableLead[] } {
  let count = 0;
  const currentProspects = loadUserProspects<ExportableLead>();
  const updatedProspects = currentProspects.map((p, idx) => {
    const key = getLeadAssetKey(p, idx);
    const matches = targetKeys.has(key) || (p.id && targetKeys.has(`id_${p.id}`));
    if (matches) {
      count++;
      return {
        ...p,
        projectId: targetProjectId,
        projectName: targetProjectName,
      };
    }
    return p;
  });
  saveUserProspects(updatedProspects);

  // Transfer hunted project results
  for (const proj of allProjects) {
    if (proj.id === targetProjectId) continue;
    const huntedList = loadProjectHuntedResults<ExportableLead>(proj.id);
    const toKeep: ExportableLead[] = [];
    const toTransfer: ExportableLead[] = [];
    for (let i = 0; i < huntedList.length; i++) {
      const h = huntedList[i];
      const key = getLeadAssetKey(h, i);
      const matches = targetKeys.has(key) || (h.id && targetKeys.has(`id_${h.id}`));
      if (matches) {
        count++;
        toTransfer.push({
          ...h,
          projectId: targetProjectId,
          projectName: targetProjectName,
        });
      } else {
        toKeep.push(h);
      }
    }
    if (toTransfer.length > 0) {
      saveProjectHuntedResults(proj.id, toKeep);
      const targetHunted = loadProjectHuntedResults<ExportableLead>(targetProjectId);
      saveProjectHuntedResults(targetProjectId, [...targetHunted, ...toTransfer]);
    }
  }

  return { movedCount: count, updatedProspects };
}

/**
 * Bulk delete leads from workspace
 */
export function deleteLeadsFromWorkspace(
  targetKeys: Set<string>,
  allProjects: LeadProject[]
): { deletedCount: number; updatedProspects: ExportableLead[] } {
  let count = 0;
  const currentProspects = loadUserProspects<ExportableLead>();
  const updatedProspects = currentProspects.filter((p, idx) => {
    const key = getLeadAssetKey(p, idx);
    const matches = targetKeys.has(key) || (p.id && targetKeys.has(`id_${p.id}`));
    if (matches) {
      count++;
      return false;
    }
    return true;
  });
  saveUserProspects(updatedProspects);

  for (const proj of allProjects) {
    const huntedList = loadProjectHuntedResults<ExportableLead>(proj.id);
    const remaining: ExportableLead[] = [];
    for (let i = 0; i < huntedList.length; i++) {
      const h = huntedList[i];
      const key = getLeadAssetKey(h, i);
      const matches = targetKeys.has(key) || (h.id && targetKeys.has(`id_${h.id}`));
      if (matches) {
        count++;
      } else {
        remaining.push(h);
      }
    }
    if (remaining.length !== huntedList.length) {
      saveProjectHuntedResults(proj.id, remaining);
    }
  }

  return { deletedCount: count, updatedProspects };
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK OPERATIONS FLOATING / INLINE BAR
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkOperationsBarProps {
  selectedCount: number;
  totalAvailableCount: number;
  selectedLeads: ExportableLead[];
  onClearSelection: () => void;
  onSelectAllAvailable: () => void;
  onOpenMoveModal: () => void;
  onOpenDeleteModal: () => void;
  onExportDone?: (message: string) => void;
  activeProjectName?: string;
}

export function BulkOperationsBar({
  selectedCount,
  totalAvailableCount,
  selectedLeads,
  onClearSelection,
  onSelectAllAvailable,
  onOpenMoveModal,
  onOpenDeleteModal,
  onExportDone,
  activeProjectName = "Workspace-Assets",
}: BulkOperationsBarProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [copiedSheets, setCopiedSheets] = useState(false);

  if (selectedCount === 0) return null;

  const handleExportCSV = () => {
    exportLeadsToCSV(selectedLeads, activeProjectName);
    setShowExportMenu(false);
    onExportDone?.(`Exported ${selectedLeads.length} selected assets to CSV`);
  };

  const handleExportJSON = () => {
    exportLeadsToJSON(selectedLeads, activeProjectName);
    setShowExportMenu(false);
    onExportDone?.(`Exported ${selectedLeads.length} selected assets to JSON`);
  };

  const handleCopySheets = async () => {
    try {
      const count = await copyLeadsForSheets(selectedLeads);
      setCopiedSheets(true);
      setShowExportMenu(false);
      onExportDone?.(`Copied ${count} selected assets for Google Sheets / Excel`);
      setTimeout(() => setCopiedSheets(false), 2500);
    } catch {
      onExportDone?.("Failed to copy to clipboard.");
    }
  };

  const isAllSelected = selectedCount === totalAvailableCount;

  return (
    <div className="sticky top-4 z-40 my-3 p-3 sm:p-3.5 bg-slate-950 text-white rounded-xl shadow-xl border border-blue-500/30 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600/30 border border-blue-400/40 text-blue-200 text-xs font-bold font-mono">
          <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
          <span>{selectedCount} Selected</span>
        </span>

        {!isAllSelected && totalAvailableCount > selectedCount && (
          <button
            type="button"
            onClick={onSelectAllAvailable}
            className="text-xs text-slate-300 hover:text-white underline underline-offset-2 cursor-pointer font-medium"
          >
            Select all {totalAvailableCount} assets
          </button>
        )}

        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
          title="Clear all selections"
        >
          <X className="w-3.5 h-3.5" />
          <span>Deselect</span>
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Bulk Move */}
        <button
          type="button"
          onClick={onOpenMoveModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer shadow-sm"
          title="Move selected assets to another project workspace"
        >
          <FolderInput className="w-3.5 h-3.5" />
          <span>Move to Project…</span>
        </button>

        {/* Bulk Export Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowExportMenu((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export ({selectedCount})</span>
            <ChevronDown className="w-3 h-3 opacity-80" />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 mt-1.5 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1 z-50 animate-in fade-in zoom-in-95">
              <button
                type="button"
                onClick={handleExportCSV}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Export as CSV (.csv)</span>
              </button>
              <button
                type="button"
                onClick={handleExportJSON}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              >
                <FileJson className="w-3.5 h-3.5 text-sky-400" />
                <span>Export as JSON (.json)</span>
              </button>
              <button
                type="button"
                onClick={handleCopySheets}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              >
                {copiedSheets ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{copiedSheets ? "Copied!" : "Copy for Sheets / Excel"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Bulk Delete */}
        <button
          type="button"
          onClick={onOpenDeleteModal}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 transition-colors cursor-pointer"
          title="Delete selected assets permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete ({selectedCount})</span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK MOVE MODAL
// ─────────────────────────────────────────────────────────────────────────────

export interface MoveAssetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLeads: ExportableLead[];
  projects: LeadProject[];
  onConfirmMove: (targetProjectId: string, targetProjectName: string) => void;
  onCreateAndMove: (newProjectName: string) => void;
}

export function MoveAssetsModal({
  isOpen,
  onClose,
  selectedLeads,
  projects,
  onConfirmMove,
  onCreateAndMove,
}: MoveAssetsModalProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => projects[0]?.id || "");
  const [showNewProjInput, setShowNewProjInput] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (showNewProjInput) {
        const trimmed = newProjName.trim();
        if (!trimmed) return;
        onCreateAndMove(trimmed);
      } else {
        const target = projects.find((p) => p.id === selectedProjectId);
        if (target) {
          onConfirmMove(target.id, target.name);
        }
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center">
              <FolderInput className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-950">
                Move {selectedLeads.length} Selected {selectedLeads.length === 1 ? "Asset" : "Assets"}
              </h3>
              <p className="text-xs text-slate-500">
                Transfer selected leads to another project workspace
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          {/* Preview of Assets Being Moved */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">Assets to Transfer:</label>
            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 max-h-32 overflow-y-auto space-y-1">
              {selectedLeads.slice(0, 6).map((lead, idx) => (
                <div key={idx} className="text-xs flex items-center justify-between gap-2 text-slate-700">
                  <span className="font-semibold truncate">{lead.businessName}</span>
                  <span className="text-[11px] font-mono text-slate-400 truncate">
                    {extractCleanDomain(lead.website) || lead.city || "Lead"}
                  </span>
                </div>
              ))}
              {selectedLeads.length > 6 && (
                <div className="text-[11px] text-slate-500 font-semibold pt-1">
                  …and {selectedLeads.length - 6} more assets
                </div>
              )}
            </div>
          </div>

          {/* Destination Project Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800">
                Select Destination Project:
              </label>
              <button
                type="button"
                onClick={() => setShowNewProjInput((v) => !v)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showNewProjInput ? "Choose Existing" : "Create New Project"}</span>
              </button>
            </div>

            {showNewProjInput ? (
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 space-y-2">
                <input
                  type="text"
                  autoFocus
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  placeholder="Enter new project name (e.g. Austin Dental Outreach Q4)"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
                <p className="text-[11px] text-slate-600">
                  A brand new workspace will be created and all selected assets moved into it immediately.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {projects.map((proj) => {
                  const isSelected = selectedProjectId === proj.id;
                  return (
                    <label
                      key={proj.id}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "bg-blue-50/80 border-blue-500 ring-1 ring-blue-500"
                          : "bg-white border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="radio"
                          name="destinationProject"
                          value={proj.id}
                          checked={isSelected}
                          onChange={() => setSelectedProjectId(proj.id)}
                          className="text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {proj.name}
                          </div>
                          {(proj.targetCategory || proj.targetCity) && (
                            <div className="text-[11px] text-slate-500 truncate">
                              {[proj.targetCategory, proj.targetCity].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                      </div>
                      <FolderKanban className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (showNewProjInput && !newProjName.trim())}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer shadow-sm"
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span>Confirm &amp; Move ({selectedLeads.length})</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK DELETE CONFIRMATION MODAL
// ─────────────────────────────────────────────────────────────────────────────

export interface DeleteAssetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLeads: ExportableLead[];
  onConfirmDelete: () => void;
}

export function DeleteAssetsModal({
  isOpen,
  onClose,
  selectedLeads,
  onConfirmDelete,
}: DeleteAssetsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-base font-bold text-slate-950">
              Permanently Delete {selectedLeads.length} {selectedLeads.length === 1 ? "Asset" : "Assets"}?
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              This will remove the selected leads from your project workspace and local CRM storage. This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 max-h-36 overflow-y-auto space-y-1">
            {selectedLeads.slice(0, 5).map((lead, idx) => (
              <div key={idx} className="text-xs flex items-center justify-between text-slate-700">
                <span className="font-semibold truncate">{lead.businessName}</span>
                <span className="text-[11px] font-mono text-slate-400 truncate">
                  {extractCleanDomain(lead.website) || lead.city || "Lead"}
                </span>
              </div>
            ))}
            {selectedLeads.length > 5 && (
              <div className="text-[11px] text-slate-500 font-semibold pt-1">
                …and {selectedLeads.length - 5} more leads
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirmDelete();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Yes, Delete {selectedLeads.length} Assets</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
