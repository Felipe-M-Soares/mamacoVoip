import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  errorInfo: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo: errorInfo.componentStack ?? null })
    // eslint-disable-next-line no-console
    console.error('Erro capturado pelo ErrorBoundary:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      const details = `${this.state.error.message}\n\n${this.state.error.stack ?? ''}\n\n${this.state.errorInfo ?? ''}`
      return (
        <div className="min-h-screen bg-discord-darker flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-discord-dark rounded-xl shadow-2xl border border-red-900/40 p-6">
            <h1 className="text-lg font-bold text-white mb-2">Algo quebrou</h1>
            <p className="text-sm text-discord-text-muted mb-4">
              Isso não deveria ter acontecido. Copia os detalhes abaixo e manda pra quem cuida do app — sem
              isso, ninguém consegue saber o que deu errado.
            </p>
            <pre className="bg-discord-darker rounded-lg p-3 text-xs text-red-400 font-mono overflow-auto max-h-64 whitespace-pre-wrap mb-4">
              {details}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(details)}
                className="flex-1 py-2.5 rounded btn-secondary text-sm"
              >
                Copiar detalhes
              </button>
              <button onClick={this.handleReload} className="flex-1 py-2.5 rounded btn-primary text-sm">
                Recarregar o app
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
