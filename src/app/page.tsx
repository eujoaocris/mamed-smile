import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-card shadow-sm">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-2xl"></span>
            <span className="text-xl font-bold text-blue-900">Mãos Amigas</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/trabalhe-conosco"
              className="hidden sm:block px-3 py-2 text-primary hover:text-primary-hover font-medium text-sm transition-colors"
            >
              Trabalhe Conosco
            </Link>
            <Link
              href="/login"
              className="px-3 py-2 text-primary hover:text-primary-hover font-medium text-sm transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/solicitar-orcamento"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover font-medium"
            >
              Solicitar Orçamento
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="text-center">
            <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-6">
              Cuidado Humanizado para Quem Você Ama
            </h1>
            <p className="text-xl text-foreground max-w-3xl mx-auto mb-8">
              Conectamos famílias a cuidadores qualificados para atendimento domiciliar
              e acompanhamento hospitalar. Profissionais verificados, atendimento 24 horas.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/solicitar-orcamento"
                className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover font-semibold text-lg flex items-center justify-center gap-2"
              >
                📋 Solicitar Orçamento
              </Link>
              <a
                href="https://wa.me/5545999999999?text=Olá,%20preciso%20de%20informações%20sobre%20cuidadores"
                className="px-8 py-4 bg-secondary-600 text-white rounded-lg hover:bg-secondary-700 font-semibold text-lg flex items-center justify-center gap-2"
              >
                💬 Falar pelo WhatsApp
              </a>
              <a
                href="#servicos"
                className="px-8 py-4 border-2 border-blue-600 text-primary rounded-lg hover:bg-info-50 font-semibold text-lg"
              >
                Conhecer Serviços
              </a>
            </div>
          </div>
        </section>

        <section id="servicos" className="bg-card py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center text-foreground mb-12">
              Nossos Serviços
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="bg-info-50 p-8 rounded-xl">
                <div className="text-4xl mb-4"></div>
                <h3 className="text-xl font-bold text-foreground mb-3">Home Care</h3>
                <p className="text-foreground">
                  Cuidado domiciliar personalizado com profissionais qualificados.
                  Acompanhamento de idosos, pós-operatório e pacientes crônicos.
                </p>
              </div>
              <div className="bg-success-50 p-8 rounded-xl">
                <div className="text-4xl mb-4"></div>
                <h3 className="text-xl font-bold text-foreground mb-3">Acompanhamento Hospitalar</h3>
                <p className="text-foreground">
                  Profissionais para acompanhar seu familiar durante internações.
                  Plantões diurnos e noturnos com relatórios diários.
                </p>
              </div>
              <div className="bg-accent-500/10 p-8 rounded-xl">
                <div className="text-4xl mb-4"></div>
                <h3 className="text-xl font-bold text-foreground mb-3">Equipe Especializada</h3>
                <p className="text-foreground">
                  Cuidadores, técnicos e auxiliares de enfermagem.
                  Todos verificados, treinados e com experiência comprovada.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20 bg-blue-900 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid md:grid-cols-4 gap-8 text-center">
              <div>
                <div className="text-4xl font-bold mb-2">500+</div>
                <div className="text-blue-200">Famílias Atendidas</div>
              </div>
              <div>
                <div className="text-4xl font-bold mb-2">200+</div>
                <div className="text-blue-200">Profissionais Cadastrados</div>
              </div>
              <div>
                <div className="text-4xl font-bold mb-2">24h</div>
                <div className="text-blue-200">Atendimento</div>
              </div>
              <div>
                <div className="text-4xl font-bold mb-2">98%</div>
                <div className="text-blue-200">Satisfação</div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-center text-foreground mb-12">
              Como Funciona
            </h2>
            <div className="grid md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">1</div>
                <h3 className="font-bold text-foreground mb-2">Entre em Contato</h3>
                <p className="text-foreground text-sm">Fale conosco pelo WhatsApp ou telefone</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">2</div>
                <h3 className="font-bold text-foreground mb-2">Avaliação</h3>
                <p className="text-foreground text-sm">Nossa equipe avalia as necessidades do paciente</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">3</div>
                <h3 className="font-bold text-foreground mb-2">Orçamento</h3>
                <p className="text-foreground text-sm">Receba um orçamento personalizado</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">4</div>
                <h3 className="font-bold text-foreground mb-2">Início do Cuidado</h3>
                <p className="text-foreground text-sm">Profissional selecionado inicia o atendimento</p>
              </div>
            </div>
          </div>
        </section>

        <section id="contato" className="py-20 bg-background">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold text-foreground mb-6">
              Precisa de Ajuda?
            </h2>
            <p className="text-xl text-foreground mb-8">
              Nossa equipe está pronta para atender você. Entre em contato agora mesmo!
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/solicitar-orcamento"
                className="px-8 py-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover font-semibold text-lg flex items-center justify-center gap-2"
              >
                📋 Solicitar Orçamento Online
              </Link>
              <a
                href="https://wa.me/5545999999999?text=Olá,%20preciso%20de%20informações%20sobre%20cuidadores"
                className="px-8 py-4 bg-secondary-600 text-white rounded-lg hover:bg-secondary-700 font-semibold text-lg flex items-center justify-center gap-2"
              >
                💬 WhatsApp
              </a>
            </div>
          </div>
        </section>

        <section className="py-12 bg-card border-t">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              É Profissional de Saúde?
            </h3>
            <p className="text-foreground mb-4">
              Cadastre-se e faça parte da nossa equipe de cuidadores
            </p>
            <Link
              href="/trabalhe-conosco"
              className="inline-block px-6 py-3 border-2 border-primary-600 text-primary-700 font-semibold rounded-lg hover:bg-primary-50 transition-colors"
            >
              Processo Seletivo Online
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-neutral-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl"></span>
                <span className="text-xl font-bold">Mãos Amigas</span>
              </div>
              <p className="text-muted-foreground">
                Cuidado humanizado para quem você ama.
                Conectando famílias a profissionais qualificados desde 2020.
              </p>
            </div>
            <div>
              <h4 className="font-bold mb-4">Contato</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li>0800 123 4567</li>
                <li>(11) 99999-9999</li>
                <li>contato@maosamigas.com</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold mb-4">Horário de Atendimento</h4>
              <ul className="space-y-2 text-muted-foreground">
                <li>Segunda a Sexta: 8h às 18h</li>
                <li>Sábado: 8h às 12h</li>
                <li>Emergências: 24 horas</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-muted-foreground">
            <p>&copy; 2024 Mãos Amigas. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
