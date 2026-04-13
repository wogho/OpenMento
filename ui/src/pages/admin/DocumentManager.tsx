/**
 * 관리자 - 교재(문서) 업로드 및 목록 관리 탭
 * (react-dropzone 기반, POST /admin/documents API 연동)
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { useAuth } from '../../hooks/useAuth';

interface UploadingDoc {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  errorMsg?: string;
}

interface DocItem {
  id: string;
  filename: string;
  category?: string;
  tags?: string;
  createdAt: string;
}

type RagProvider = 'openai' | 'cohere' | 'google';

interface RagProviderInfo {
  id: RagProvider;
  available: boolean;
}

interface RagProvidersResponse {
  defaultProvider: RagProvider;
  providers: RagProviderInfo[];
}

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export default function DocumentManager() {
  const { token } = useAuth();
  const [uploads, setUploads] = useState<UploadingDoc[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  
  // Category / Tags states for upload
  const [uploadCategory, setUploadCategory] = useState<string>('');
  const [uploadTagsStr, setUploadTagsStr] = useState<string>('');

  // Filtering states
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [enableRag, setEnableRag] = useState<boolean>(true);
  const [selectedRagProvider, setSelectedRagProvider] = useState<RagProvider>('openai');
  const [ragProviders, setRagProviders] = useState<RagProviderInfo[]>([]);
  const [ragProvidersError, setRagProvidersError] = useState<string | null>(null);

  const fetchDocuments = useCallback(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: DocItem[]) => setDocuments(data))
      .catch(() => setListError('교재 목록을 불러오지 못했습니다.'));
  }, [token]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/rag/providers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: RagProvidersResponse) => {
        setRagProviders(data.providers);
        setSelectedRagProvider(data.defaultProvider);
        setRagProvidersError(null);
      })
      .catch(() => {
        setRagProvidersError('RAG 임베딩 프로바이더 목록을 불러오지 못했습니다.');
      });
  }, [token]);

  const availableRagProviders = useMemo(
    () => ragProviders.filter((p) => p.available),
    [ragProviders],
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setDropError(null);

      if (enableRag && availableRagProviders.length === 0) {
        setDropError('RAG 임베딩이 활성화되어 있지만 사용 가능한 API 키가 없습니다. 시스템 외부 연동 Key 저장소에서 RAG 전용 키를 먼저 등록해 주세요.');
        return;
      }

      const category = uploadCategory.trim();
      const tags = uploadTagsStr
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      acceptedFiles.forEach((file) => {
        const uploadId = crypto.randomUUID();
        setUploads((prev) => [
          ...prev,
          { id: uploadId, name: file.name, progress: 0, status: 'uploading' },
        ]);

        const formData = new FormData();
        formData.append('file', file);
        if (category) formData.append('category', category);
        if (tags.length > 0) formData.append('tags', JSON.stringify(tags));
        formData.append('enableRag', String(enableRag));
        if (enableRag) {
          formData.append('embeddingProvider', selectedRagProvider);
        }

        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, progress: pct } : u)),
            );
          }
        });
        xhr.addEventListener('load', () => {
          let payload: unknown = null;
          try {
            payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            payload = null;
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, progress: 100, status: 'completed' } : u)),
            );

            const queued =
              xhr.status === 202 &&
              typeof payload === 'object' &&
              payload !== null &&
              'status' in payload &&
              (payload as { status?: string }).status === 'queued';

            if (queued) {
              setDropError(null);
              setTimeout(() => {
                fetchDocuments();
              }, 1500);
            } else if (
              typeof payload === 'object' &&
              payload !== null &&
              'id' in payload &&
              'filename' in payload &&
              'createdAt' in payload
            ) {
              const saved = payload as DocItem;
              setDocuments((prev) => [saved, ...prev]);
            } else {
              fetchDocuments();
            }

            setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.id !== uploadId));
            }, 3000);
          } else {
            const errorMessage =
              typeof payload === 'object' && payload !== null && 'error' in payload
                ? String((payload as { error?: string }).error)
                : `서버 오류 (${xhr.status})`;
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId ? { ...u, status: 'error', errorMsg: errorMessage } : u,
              ),
            );
          }
        });
        xhr.addEventListener('error', () => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === uploadId ? { ...u, status: 'error', errorMsg: '네트워크 오류' } : u,
            ),
          );
        });
        xhr.open('POST', `${API_BASE}/admin/documents`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });
      
      // Upload 후 입력 정보 유지하거나 초기화할 수 있지만 유지하는 방향으로 둠.
    },
    [
      token,
      uploadCategory,
      uploadTagsStr,
      enableRag,
      selectedRagProvider,
      availableRagProviders.length,
      fetchDocuments,
    ],
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0];
    if (!first) return;
    const code = first.errors[0]?.code;
    if (code === 'file-too-large') {
      setDropError('파일 용량이 50MB를 초과합니다. 더 작은 파일을 사용해 주세요.');
    } else if (code === 'file-invalid-type') {
      setDropError('PDF 파일만 업로드할 수 있습니다.');
    } else {
      setDropError(first.errors[0]?.message ?? '파일을 업로드할 수 없습니다.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'application/pdf': ['.pdf'],
      'application/x-pdf': ['.pdf'],
      'application/octet-stream': ['.pdf'],
    },
    maxSize: 50 * 1024 * 1024,
  });

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('이 교재를 삭제하시겠습니까? (연결된 임베딩 데이터도 모두 삭제됩니다)')) return;
    try {
      const r = await fetch(`${API_BASE}/admin/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
      }
    } catch {
      alert('오류가 발생했습니다.');
    }
  };

  const categories = useMemo(() => {
    const cats = new Set<string>();
    documents.forEach((d) => {
      if (d.category) cats.add(d.category);
    });
    return Array.from(cats);
  }, [documents]);

  const filteredDocs = useMemo(() => {
    if (!selectedCategory) return documents;
    return documents.filter((d) => d.category === selectedCategory);
  }, [documents, selectedCategory]);

  const providerLabelMap: Record<RagProvider, string> = {
    openai: 'OpenAI',
    cohere: 'Cohere',
    google: 'Google',
  };

  return (
    <div className="flex h-full min-h-[600px] bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      {/* Sidebar Explorer */}
      <aside className="w-64 bg-gray-50 border-r border-gray-200 flex flex-col hidden md:flex">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800">탐색기</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-1">
            <li>
              <button
                onClick={() => setSelectedCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${
                  selectedCategory === null ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                📁 전체 도서
              </button>
            </li>
            {categories.map((cat) => (
              <li key={cat}>
                <button
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                    selectedCategory === cat ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span>📂</span>
                  <span className="truncate">{cat}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-white overflow-hidden p-6 space-y-6">
        
        {/* Upload Form Area */}
        <section className="bg-gray-50 border border-gray-100 rounded-xl p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">새 교재 등록</h2>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
             <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">카테고리</label>
                <input
                  type="text"
                  placeholder="예: 백엔드강의, 강사명 등"
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
             </div>
             <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">태그 (콤마 구분)</label>
                <input
                  type="text"
                  placeholder="예: Spring, Java, 중급"
                  value={uploadTagsStr}
                  onChange={(e) => setUploadTagsStr(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
             </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={enableRag}
                  onChange={(e) => setEnableRag(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                RAG 임베딩 활성화
              </label>
              <p className="mt-1 text-xs text-gray-500">
                체크 해제 시 PDF만 등록되며 벡터 임베딩은 생성하지 않습니다.
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">RAG 임베딩 API 선택</label>
              <select
                value={selectedRagProvider}
                onChange={(e) => setSelectedRagProvider(e.target.value as RagProvider)}
                disabled={!enableRag}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {ragProviders.length > 0
                  ? ragProviders.map((provider) => (
                    <option
                      key={provider.id}
                      value={provider.id}
                      disabled={!provider.available}
                    >
                      {providerLabelMap[provider.id]}{provider.available ? '' : ' (키 미설정)'}
                    </option>
                  ))
                  : (
                    <option value="openai">OpenAI</option>
                  )}
              </select>
              {ragProvidersError && <p className="mt-1 text-xs text-red-600">{ragProvidersError}</p>}
            </div>
          </div>

          <div
            {...getRootProps()}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition
              ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-white bg-white'}
            `}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center justify-center gap-3">
              <span className="text-4xl">📄</span>
              <div>
                <p className="text-gray-700 font-medium">
                  {isDragActive
                    ? '여기에 PDF 파일을 놓아주세요'
                    : `카테고리와 태그 입력 후, 이곳에 PDF 교재 파일을 드롭하세요 (${enableRag ? `RAG: ${providerLabelMap[selectedRagProvider]}` : 'RAG 비활성'})`}
                </p>
                <p className="text-xs text-gray-500 mt-1">최대 용량: 50MB (Only .pdf)</p>
              </div>
            </div>
          </div>
          {dropError && <p className="mt-2 text-sm text-red-600 flex items-center gap-1">⚠️ {dropError}</p>}
        </section>

        {/* Uploading Status */}
        {uploads.length > 0 && (
          <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">현재 업로드 현황</h3>
            <div className="space-y-3">
              {uploads.map((upload) => (
                <div key={upload.id} className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="truncate max-w-[200px]">{upload.name}</span>
                    <span className={`text-xs font-medium ${
                        upload.status === 'completed' ? 'text-green-600' : upload.status === 'error' ? 'text-red-500' : 'text-blue-600'
                      }`}>
                      {upload.status === 'completed' ? '완료' : upload.status === 'error' ? `실패` : `${upload.progress}%`}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${upload.status === 'completed' ? 'bg-green-500' : upload.status === 'error' ? 'bg-red-400' : 'bg-blue-500'}`}
                      style={{ width: `${upload.progress}%` }}
                    />
                  </div>
                  {upload.status === 'error' && upload.errorMsg && (
                    <p className="text-xs text-red-500">{upload.errorMsg}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Document List */}
        <section className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 shrink-0">
             <h2 className="text-lg font-semibold text-gray-800">
               {selectedCategory ? `'${selectedCategory}' 교재 목록` : '전체 교재 목록'}
             </h2>
          </div>
          {listError && <p className="mb-2 text-sm text-red-600">⚠️ {listError}</p>}
          
          <div className="flex-1 overflow-y-auto bg-white rounded-xl shadow-sm border border-gray-200">
            <ul className="divide-y divide-gray-100">
              {filteredDocs.length === 0 ? (
                <li className="p-8 text-center text-sm text-gray-500">
                  해당 목록에 표시할 교재가 없습니다.
                </li>
              ) : (
                filteredDocs.map((doc) => {
                  let tagsArr: string[] = [];
                  if (doc.tags) {
                    try {
                      tagsArr = JSON.parse(doc.tags);
                    } catch {
                      // plain string
                      tagsArr = [doc.tags];
                    }
                  }

                  return (
                    <li key={doc.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition group">
                      <div className="flex flex-col gap-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                           <span className="text-xl">📄</span>
                           <span className="text-sm font-medium text-gray-900 truncate">{doc.filename}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 px-7">
                           {doc.category && (
                             <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                               {doc.category}
                             </span>
                           )}
                           {tagsArr.map(t => (
                             <span key={t} className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                               #{t}
                             </span>
                           ))}
                        </div>
                        <p className="text-xs text-gray-400 px-7">등록일: {doc.createdAt}</p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(doc.id, e)}
                        className="shrink-0 p-2 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                        title="기록 삭제"
                      >
                        🗑️
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </section>

      </main>
    </div>
  );
}
