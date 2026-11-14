import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  BookOpen,
  FileText,
  ShieldCheck,
  HelpCircle,
  Wrench,
  MessageSquareQuote,
  CheckCircle2,
  AlertCircle,
  Plus,
  Upload,
  Archive,
  Tag,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import {
  getKnowledgeItems,
  createKnowledgeItem,
  publishKnowledgeItem,
  archiveKnowledgeItem
} from '../services/api';

const CATEGORIES = [
  { id: 'all', label: 'All Categories', icon: BookOpen },
  { id: 'policy', label: 'Policies', icon: ShieldCheck },
  { id: 'faq', label: 'FAQs', icon: HelpCircle },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: Wrench },
  { id: 'canned_response', label: 'Canned Responses', icon: MessageSquareQuote },
  { id: 'product_guide', label: 'Product Guides', icon: FileText },
  { id: 'resolved_case', label: 'Resolved Cases', icon: CheckCircle2 }
];

export default function KnowledgeHubDrawer({
  isOpen,
  onClose,
  currentUserRole = 'agent', // 'agent' | 'support_lead' | 'admin'
  onInsertCannedResponse = null
}) {
  const [activeTab, setActiveTab] = useState('published'); // 'published' | 'drafts'
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // New Draft modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCategory, setDraftCategory] = useState('policy');
  const [draftContent, setDraftContent] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLeadOrAdmin = currentUserRole === 'support_lead' || currentUserRole === 'admin';

  const loadItems = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params = {
        isPublishedOnly: activeTab === 'published' ? 'true' : 'false',
      };
      if (selectedCategory !== 'all') {
        params.category = selectedCategory;
      }
      if (searchQuery.trim()) {
        params.query = searchQuery.trim();
      }

      const res = await getKnowledgeItems(params);
      if (res?.success && Array.isArray(res.items)) {
        setItems(res.items);
      } else {
        setItems([]);
      }
    } catch (err) {
      console.warn('[KnowledgeHub UI load error]:', err.message);
      setErrorMessage(err.message || 'Failed to load Knowledge Hub entries');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadItems();
    }
  }, [isOpen, activeTab, selectedCategory]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadItems();
  };

  const handleCreateDraft = async (e) => {
    e.preventDefault();
    if (!draftTitle.trim() || !draftContent.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const tagsArray = draftTags
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const res = await createKnowledgeItem({
        category: draftCategory,
        title: draftTitle.trim(),
        contentMarkdown: draftContent.trim(),
        tags: tagsArray,
        isPublished: false
      });

      if (res?.success) {
        setSuccessMessage('Draft created successfully!');
        setShowNewModal(false);
        setDraftTitle('');
        setDraftContent('');
        setDraftTags('');
        setActiveTab('drafts');
        loadItems();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to create draft');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublish = async (itemId) => {
    if (!isLeadOrAdmin) {
      setErrorMessage('Permission denied: Only Support Leads and Admins can publish knowledge articles (RBAC).');
      return;
    }

    try {
      const res = await publishKnowledgeItem(itemId);
      if (res?.success) {
        setSuccessMessage(`Article published successfully! Version: v${res.item?.published_version || '1.0'}`);
        loadItems();
        setTimeout(() => setSuccessMessage(null), 3500);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Publishing failed');
    }
  };

  const handleArchive = async (itemId) => {
    if (!isLeadOrAdmin) {
      setErrorMessage('Permission denied: Only Support Leads and Admins can archive knowledge articles (RBAC).');
      return;
    }

    try {
      const res = await archiveKnowledgeItem(itemId);
      if (res?.success) {
        setSuccessMessage('Article archived successfully.');
        loadItems();
        setTimeout(() => setSuccessMessage(null), 3500);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Archive failed');
    }
  };

  const handleCopyOrInsert = (item) => {
    if (onInsertCannedResponse) {
      onInsertCannedResponse(item.content_markdown || item.title);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    } else if (navigator?.clipboard) {
      navigator.clipboard.writeText(item.content_markdown || item.title);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/80 backdrop-blur-sm flex justify-end animate-fadeIn">
      <div
        className="w-full max-w-2xl bg-[#0B0F17] border-l border-[#1F2937] h-full overflow-hidden flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header */}
        <div className="px-6 py-4 border-b border-[#1F2937] bg-[#0E1522] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-[#7CFF00]/10 border border-[#7CFF00]/30 flex items-center justify-center text-[#7CFF00]">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-[#FFFFFF]">Team Knowledge Hub</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#1F2937] text-[#9CA3AF]">
                  Brand Knowledge & Policies
                </span>
              </div>
              <span className="text-[11px] text-[#6B7280]">
                Grounded documentation, operating procedures, and canned answers
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold transition-all shadow-neon-sm"
              title="Create new draft"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Article</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#FFFFFF] hover:bg-[#1F2937] transition-colors"
              title="Close Knowledge Hub"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Published vs Drafts Tabs */}
        <div className="px-6 pt-3 pb-2 bg-[#0E1522] border-b border-[#1F2937] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveTab('published')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeTab === 'published'
                  ? 'bg-[#1F2937] text-[#7CFF00] border border-[#7CFF00]/40'
                  : 'text-[#9CA3AF] hover:text-[#FFFFFF]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Approved & Published</span>
            </button>
            <button
              onClick={() => setActiveTab('drafts')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                activeTab === 'drafts'
                  ? 'bg-[#1F2937] text-[#F59E0B] border border-[#F59E0B]/40'
                  : 'text-[#9CA3AF] hover:text-[#FFFFFF]'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Drafts & Review</span>
            </button>
          </div>

          <span className="text-[11px] text-[#6B7280]">
            Role: <strong className="text-[#E5E7EB] capitalize">{currentUserRole.replace('_', ' ')}</strong>
          </span>
        </div>

        {/* 3. Search and Category Filter Bar */}
        <div className="p-4 bg-[#0B0F17] border-b border-[#1F2937] space-y-3 shrink-0">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-[#6B7280] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search knowledge by topic, policy, question, or tags..."
              className="w-full bg-[#111827] border border-[#1F2937] focus:border-[#7CFF00] rounded-xl pl-9 pr-20 py-2 text-xs text-[#FFFFFF] placeholder-[#6B7280] focus:outline-none transition-colors"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-[#1F2937] hover:bg-[#374151] text-[#7CFF00] text-[11px] font-semibold transition-colors"
            >
              Search
            </button>
          </form>

          {/* Category Chips */}
          <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-[#7CFF00] text-[#090909] font-bold shadow-neon-sm'
                      : 'bg-[#111827] text-[#9CA3AF] hover:text-[#FFFFFF] border border-[#1F2937]'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 4. Feedback Alerts */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 bg-[#450A0A] border border-[#991B1B] rounded-xl text-xs text-[#FCA5A5] flex items-center justify-between animate-fadeIn">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="text-[#FCA5A5] hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {successMessage && (
          <div className="mx-4 mt-3 p-3 bg-[#064E3B] border border-[#059669] rounded-xl text-xs text-[#6EE7B7] flex items-center justify-between animate-fadeIn">
            <span>{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="text-[#6EE7B7] hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 5. Warning banner if viewing drafts */}
        {activeTab === 'drafts' && (
          <div className="mx-4 mt-3 p-2.5 bg-[#451A03] border border-[#B45309] rounded-xl text-xs text-[#FDE68A] flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-[#F59E0B] shrink-0" />
            <span>
              <strong>Draft View:</strong> These entries are in review and <em>never</em> presented to customers as approved policies.
            </span>
          </div>
        )}

        {/* 6. Knowledge Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-[#6B7280]">
              Loading Knowledge Hub articles...
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#6B7280] space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-[#374151]" />
              <p>No knowledge articles found matching your criteria.</p>
              {activeTab === 'published' && (
                <button
                  onClick={() => setShowNewModal(true)}
                  className="text-[#7CFF00] hover:underline"
                >
                  Create the first article draft
                </button>
              )}
            </div>
          ) : (
            items.map(item => {
              const isPublished = Boolean(item.is_published);
              const isCanned = item.category === 'canned_response';

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-all text-xs space-y-2.5 ${
                    isPublished
                      ? 'bg-[#111827] border-[#1F2937] hover:border-[#7CFF00]/40'
                      : 'bg-[#18181B] border-[#F59E0B]/30'
                  }`}
                >
                  {/* Item Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-[#FFFFFF]">{item.title}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                          isPublished
                            ? 'bg-[#7CFF00]/10 text-[#7CFF00] border border-[#7CFF00]/30'
                            : 'bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30'
                        }`}>
                          {item.category.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-[#9CA3AF] font-mono">
                          v{item.version || '1.0'} {isPublished ? '(Published)' : '(Draft)'}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center space-x-1.5 shrink-0">
                      {isCanned && (
                        <button
                          onClick={() => handleCopyOrInsert(item)}
                          className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-[#7CFF00]/10 hover:bg-[#7CFF00]/20 text-[#7CFF00] border border-[#7CFF00]/30 text-[11px] font-semibold transition-colors"
                          title="Insert canned response"
                        >
                          {copiedId === item.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedId === item.id ? 'Inserted' : 'Use Canned'}</span>
                        </button>
                      )}

                      {!isPublished && (
                        <button
                          onClick={() => handlePublish(item.id)}
                          disabled={!isLeadOrAdmin}
                          className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            isLeadOrAdmin
                              ? 'bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] shadow-neon-sm'
                              : 'bg-[#374151] text-[#9CA3AF] cursor-not-allowed opacity-60'
                          }`}
                          title={isLeadOrAdmin ? "Publish this version" : "Only Support Lead or Admin can publish"}
                        >
                          <Upload className="w-3 h-3" />
                          <span>Publish</span>
                        </button>
                      )}

                      {isPublished && isLeadOrAdmin && (
                        <button
                          onClick={() => handleArchive(item.id)}
                          className="flex items-center space-x-1 px-2 py-1 rounded-lg bg-[#1F2937] hover:bg-[#374151] text-[#9CA3AF] hover:text-[#EF4444] text-[11px] transition-colors"
                          title="Archive article"
                        >
                          <Archive className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Markdown Content */}
                  <div className="p-3 bg-[#0B0F17] rounded-lg border border-[#1F2937] text-[#D1D5DB] leading-relaxed whitespace-pre-wrap font-sans">
                    {item.content_markdown}
                  </div>

                  {/* Tags and Metadata */}
                  {Array.isArray(item.tags) && item.tags.length > 0 && (
                    <div className="flex items-center space-x-1.5 pt-1">
                      <Tag className="w-3 h-3 text-[#6B7280]" />
                      <div className="flex flex-wrap gap-1">
                        {item.tags.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.2 rounded bg-[#1F2937] text-[10px] text-[#9CA3AF] font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 7. Modal: Create New Draft */}
        {showNewModal && (
          <div className="fixed inset-0 z-60 bg-black/85 flex items-center justify-center p-4">
            <div className="bg-[#111827] border border-[#374151] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
                <span className="font-bold text-sm text-[#FFFFFF]">Create Knowledge Article Draft</span>
                <button onClick={() => setShowNewModal(false)} className="text-[#9CA3AF] hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateDraft} className="space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="e.g. Standard 30-Day Return Window Policy"
                    className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Category</label>
                    <select
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    >
                      <option value="policy">Policy</option>
                      <option value="faq">FAQ</option>
                      <option value="troubleshooting">Troubleshooting</option>
                      <option value="canned_response">Canned Response</option>
                      <option value="product_guide">Product Guide</option>
                      <option value="resolved_case">Resolved Case</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={draftTags}
                      onChange={(e) => setDraftTags(e.target.value)}
                      placeholder="refund, window, packaging"
                      className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#7CFF00] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#9CA3AF] mb-1">Content Markdown</label>
                  <textarea
                    required
                    rows={6}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Provide clear rules, troubleshooting steps, or exact canned response text..."
                    className="w-full bg-[#0B0F17] border border-[#1F2937] focus:border-[#7CFF00] rounded-xl p-3 text-xs text-white focus:outline-none font-sans leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#1F2937]">
                  <button
                    type="button"
                    onClick={() => setShowNewModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-[#9CA3AF] hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting || !draftTitle.trim() || !draftContent.trim()}
                    className="px-4 py-2 rounded-xl bg-[#7CFF00] hover:bg-[#8EFF1F] text-[#090909] text-xs font-bold transition-all shadow-neon-sm disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving...' : 'Save as Draft'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
