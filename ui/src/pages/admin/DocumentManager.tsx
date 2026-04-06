/**
 * 관리자 - 교재(문서) 업로드 및 목록 관리 탭
 * (react-dropzone 기반, POST /admin/documents API 연동)
 */

import { useCallback, useEffect, useState } from 'react';
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
  createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export default function DocumentManager() {
  const { token } = useAuth();
  const [uploads, setUploads] = useState<UploadingDoc[]>([]);
  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // 교재 목록 조회
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/admin/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: DocItem[]) => setDocuments(data))
      .catch(() => setListError('교재 목록을 불러오지 못했습니다.'));
  }, [token]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setDropError(null);
      acceptedFiles.forEach((file) => {
        const uploadId = crypto.randomUUID();
        setUploads((prev) => [
          ...prev,
          { id: uploadId, name: file.name, progress: 0, status: 'uploading' },
        ]);

        const formData = new FormData();
        formData.append('file', file);

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
          if (xhr.status >= 200 && xhr.status < 300) {
            const saved: DocItem = JSON.parse(xhr.responseText);
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, progress: 100, status: 'completed' } : u)),
            );
            setDocuments((prev) => [saved, ...prev]);
            setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.id !== uploadId));
            }, 3000);
          } else {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === uploadId ? { ...u, status: 'error', errorMsg: `서버 오류 (${xhr.status})` } : u,
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
    },
    [token],
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
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024, // 50MB
  });

  const handleDelete = async (id: string) => {
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
      // 오류 시 목록 유지 (사용자 재시도 가능)
    }
  };

  return (
    <div className="space-y-6">
      {/* ── 드래그 앤 드롭 영역 ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">새 교재 등록</h2>
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition
            ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50 bg-white'}
          `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center justify-center gap-3">
            <span className="text-4xl">📄</span>
            <div>
              <p className="text-gray-700 font-medium">
                {isDragActive ? '여기에 PDF 파일을 놓아주세요' : 'PDF 교재 파일을 드래그하여 놓거나 클릭하여 선택하세요'}
              </p>
              <p className="text-xs text-gray-500 mt-1">업로드 시점부터 백그라운드에서 자동 청킹 및 임베딩(벡터 DB 저장)이 시작됩니다.</p>
              <p className="text-xs text-gray-400 mt-0.5">최대 용량: 50MB (Only .pdf)</p>
            </div>
          </div>
        </div>

        {/* 거절 파일 인라인 에러 */}
        {dropError && (
          <p className="mt-2 text-sm text-red-600 flex items-center gap-1">
            ⚠️ {dropError}
          </p>
        )}
      </section>

      {/* ── 업로드 현황 ── */}
      {uploads.length > 0 && (
        <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">현재 업로드 및 처리 현황</h3>
          <div className="space-y-3">
            {uploads.map((upload) => (
              <div key={upload.id} className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="truncate max-w-[200px] sm:max-w-xs">{upload.name}</span>
                  <span
                    className={`text-xs font-medium ${
                      upload.status === 'completed'
                        ? 'text-green-600'
                        : upload.status === 'error'
                          ? 'text-red-500'
                          : 'text-blue-600'
                    }`}
                  >
                    {upload.status === 'completed'
                      ? '완료'
                      : upload.status === 'error'
                        ? `실패: ${upload.errorMsg ?? '오류'}`
                        : `${Math.floor(upload.progress)}% 처리 중`}
                  </span>
                </div>
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      upload.status === 'completed'
                        ? 'bg-green-500'
                        : upload.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-blue-500'
                    }`}
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 기 등록 문서 목록 ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">등록된 교재 목록</h2>
        {listError && (
          <p className="mb-2 text-sm text-red-600 flex items-center gap-1">⚠️ {listError}</p>
        )}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {documents.length === 0 ? (
              <li className="p-8 text-center text-sm text-gray-500">등록된 교재가 없습니다.</li>
            ) : (
              documents.map((doc) => (
                <li key={doc.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="text-2xlshrink-0">📖</span>
                    <div className="truncate">
                      <p className="text-sm font-medium text-gray-900 truncate">{doc.filename}</p>
                      <p className="text-xs text-gray-400">등록일: {doc.createdAt}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                    title="기록 삭제"
                  >
                    🗑️
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}