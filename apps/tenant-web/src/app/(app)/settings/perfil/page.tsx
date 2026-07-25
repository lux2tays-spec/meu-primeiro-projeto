'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/lib/api'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  staff: 'Colaborador',
  root: 'Root',
}

export default function PerfilPage() {
  const qc = useQueryClient()
  const { data: me, isLoading } = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me })

  // (a) Dados pessoais
  const [form, setForm] = useState({ name: '', phone: '' })
  const [profileError, setProfileError] = useState('')
  const [profileSaved, setProfileSaved] = useState(false)

  // (b) Troca de e-mail
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailForm, setEmailForm] = useState({ new_email: '', password: '' })
  const [emailError, setEmailError] = useState('')
  const [emailFeedback, setEmailFeedback] = useState('')

  // (c) Senha
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' })
  const [pwError, setPwError] = useState('')
  const [pwSaved, setPwSaved] = useState(false)

  useEffect(() => {
    if (me) setForm({ name: me.name ?? '', phone: me.phone ?? '' })
  }, [me])

  const saveProfile = useMutation({
    mutationFn: (data: typeof form) =>
      authApi.updateMe({ name: data.name.trim(), phone: data.phone.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-me'] })
      setProfileError('')
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    },
    onError: (e: any) => { setProfileSaved(false); setProfileError(e.message) },
  })

  const changeEmail = useMutation({
    mutationFn: (data: typeof emailForm) =>
      authApi.changeEmail(data.new_email.trim().toLowerCase(), data.password),
    onSuccess: (res) => {
      setEmailError('')
      setEmailFeedback(res.message)
      if (res.sent) {
        setShowEmailForm(false)
        setEmailForm({ new_email: '', password: '' })
      }
    },
    onError: (e: any) => { setEmailFeedback(''); setEmailError(e.message) },
  })

  const changePassword = useMutation({
    mutationFn: (data: typeof pwForm) =>
      authApi.changePassword(data.current_password, data.new_password),
    onSuccess: () => {
      setPwError('')
      setPwSaved(true)
      setPwForm({ current_password: '', new_password: '' })
      setTimeout(() => setPwSaved(false), 3000)
    },
    onError: (e: any) => { setPwSaved(false); setPwError(e.message) },
  })

  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  if (isLoading) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Meu Perfil</h1>
        <p className="text-gray-400 text-sm">Carregando...</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
        <p className="text-gray-400 text-sm mt-1">Seus dados pessoais de acesso — separados dos dados do negócio.</p>
      </div>

      {/* (a) Dados pessoais */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Dados pessoais</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nome</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls} placeholder="Seu nome" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className={inputCls} placeholder="(11) 99999-9999" />
          </div>
        </div>

        {profileError && <p className="text-red-500 text-xs">{profileError}</p>}
        {profileSaved && <p className="text-green-600 text-xs">Dados salvos com sucesso.</p>}

        <button
          onClick={() => saveProfile.mutate(form)}
          disabled={saveProfile.isPending || form.name.trim().length < 2}
          className="w-full h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {saveProfile.isPending ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      {/* (b) E-mail de login */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">E-mail de login</h2>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-700">{me?.email}</span>
          {me?.email_verified ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">Verificado</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600 font-medium">Não verificado</span>
          )}
        </div>

        {emailFeedback && <p className="text-green-600 text-xs">{emailFeedback}</p>}

        {!showEmailForm ? (
          <button
            onClick={() => { setShowEmailForm(true); setEmailFeedback(''); setEmailError('') }}
            className="h-10 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
          >
            Trocar e-mail
          </button>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Novo e-mail</label>
              <input type="email" value={emailForm.new_email}
                onChange={(e) => setEmailForm((f) => ({ ...f, new_email: e.target.value }))}
                className={inputCls} placeholder="novo@email.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sua senha (para confirmar)</label>
              <input type="password" value={emailForm.password}
                onChange={(e) => setEmailForm((f) => ({ ...f, password: e.target.value }))}
                className={inputCls} placeholder="••••••••" />
            </div>
            <p className="text-gray-400 text-xs">
              Enviaremos um link de confirmação para o novo e-mail. A troca só acontece após a confirmação.
            </p>
            {emailError && <p className="text-red-500 text-xs">{emailError}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => changeEmail.mutate(emailForm)}
                disabled={changeEmail.isPending || !emailForm.new_email.trim() || !emailForm.password}
                className="flex-1 h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                {changeEmail.isPending ? 'Enviando...' : 'Enviar link de confirmação'}
              </button>
              <button
                onClick={() => { setShowEmailForm(false); setEmailError('') }}
                className="h-10 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* (c) Senha */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Alterar senha</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Senha atual</label>
            <input type="password" value={pwForm.current_password}
              onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))}
              className={inputCls} placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nova senha (mín. 8 caracteres)</label>
            <input type="password" value={pwForm.new_password}
              onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))}
              className={inputCls} placeholder="••••••••" />
          </div>
        </div>

        {pwError && <p className="text-red-500 text-xs">{pwError}</p>}
        {pwSaved && <p className="text-green-600 text-xs">Senha alterada com sucesso.</p>}

        <button
          onClick={() => changePassword.mutate(pwForm)}
          disabled={changePassword.isPending || !pwForm.current_password || pwForm.new_password.length < 8}
          className="w-full h-10 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {changePassword.isPending ? 'Alterando...' : 'Alterar senha'}
        </button>
      </div>

      {/* (d) Papel e negócio (somente leitura) */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Acesso</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Papel</p>
            <p className="text-sm text-gray-700">{ROLE_LABELS[me?.role ?? ''] ?? me?.role ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-1">Negócio</p>
            <p className="text-sm text-gray-700">{me?.business_name ?? '—'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
