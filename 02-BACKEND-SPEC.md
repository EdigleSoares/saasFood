# SPEC-02: Backend do Micro-SaaS Food Service

**Status:** proposta para validação antes da implementação  
**Escopo:** API, banco de dados, autenticação, isolamento multi-tenant, pedidos, pagamentos e notificações  
**Fora deste documento:** implementação visual do PDV administrativo e do cardápio do cliente

## 1. Objetivo

Definir uma base segura, rápida de implementar e simples de manter para o backend do Micro-SaaS de Food Service. O backend atenderá o futuro cardápio web e o futuro PDV por uma API comum, sem incluir neste escopo as interfaces visuais.

O MVP atende restaurantes no Brasil, com uma unidade por restaurante. A cobrança da assinatura do SaaS não faz parte deste backend inicial.

## 2. Decisões de arquitetura

- **Runtime e framework:** TypeScript em Node.js, NestJS, organizado como monólito modular.
- **API:** REST versionada em `/api/v1`, com contrato OpenAPI/Swagger.
- **Persistência:** PostgreSQL e Prisma Migrate. Valores monetários são armazenados como `NUMERIC(12,2)` e manipulados como `Decimal`, nunca como ponto flutuante.
- **Tenancy:** banco compartilhado. Cada registro pertencente a um restaurante carrega `restaurante_id`; autorização na API e Row-Level Security (RLS) no PostgreSQL são camadas complementares.
- **Resolução do tenant:** slug do subdomínio, por exemplo `{slug}.seusaas.com`. A API valida o host e resolve o restaurante ativo; não confia em `restaurante_id` enviado pelo cliente.
- **Autenticação administrativa:** JWT de acesso e refresh token rotativo em cookie `HttpOnly`, `Secure` e `SameSite` adequado ao domínio. Senhas com Argon2id, rate limit e recuperação por e-mail. MFA fica fora do MVP.
- **Papéis fixos:** `OWNER`, `MANAGER` e `ATTENDANT`. Um usuário pertence a um restaurante no MVP.
- **Onboarding:** criação de restaurante e primeiro usuário feita por processo interno protegido (comando administrativo ou operação interna autenticada), nunca por cadastro público.
- **Armazenamento de imagens:** serviço S3-compatible; o banco guarda a chave/URL pública controlada, não os arquivos binários.
- **Integrações externas:** módulos adaptadores. O core não depende de SDK, status ou nomenclatura específica do Asaas.

Neste documento, “Pix com confirmação automática” significa que o gateway confirma o recebimento por integração. Não significa o produto de pagamentos recorrentes chamado Pix Automático.

## 3. Módulos NestJS

1. `TenancyModule`: resolução de subdomínio, contexto do tenant e aplicação do contexto RLS.
2. `AuthModule`: login, refresh, logout, convite, recuperação de senha e sessões.
3. `UsersModule`: usuários e papéis do restaurante.
4. `RestaurantModule`: dados, configurações, modalidades e horários.
5. `CatalogModule`: categorias, produtos, tamanhos, sabores, grupos e adicionais.
6. `CustomerModule`: perfis, endereços e tokens de dispositivo do cliente.
7. `OrderModule`: criação, cálculo, transições, histórico e consulta de pedidos.
8. `PaymentModule`: Pix manual, interface de gateway e conciliação.
9. `AsaasModule`: implementação do adaptador Asaas e recepção de webhooks.
10. `NotificationModule`: inscrições e envio de Web Push.
11. `MediaModule`: metadados e integração com armazenamento S3-compatible.
12. `HealthModule`: verificações de disponibilidade e prontidão.

O monólito deve manter módulos e dependências explícitos. Não introduzir microserviços, filas externas ou abstrações genéricas sem necessidade comprovada. Tarefas assíncronas poderão começar com uma tabela outbox e worker do próprio backend.

## 4. Isolamento multi-tenant

### 4.1 Regras obrigatórias

- Toda tabela de domínio pertencente a um restaurante contém `restaurante_id UUID NOT NULL`.
- IDs de registros são UUIDs. Restrições e relacionamentos incluem o tenant sempre que necessário para impedir relações entre restaurantes distintos.
- Chaves estrangeiras entre entidades tenant-scoped usam pares como `(restaurante_id, produto_id)` referenciando uma chave única correspondente. Isso inclui tabelas de associação e itens de pedido.
- O tenant vem do host validado ou da sessão autenticada. Para rotas administrativas, o `restaurante_id` do JWT deve corresponder ao tenant resolvido.
- Toda operação autenticada verifica o papel e o tenant antes de ler ou alterar dados.
- Não usar consultas administrativas globais para atender tráfego normal.

### 4.2 RLS com Prisma

O papel de banco usado pela API não pode ser proprietário das tabelas nem possuir `BYPASSRLS`. As políticas são `ENABLE` e `FORCE ROW LEVEL SECURITY` nas tabelas tenant-scoped.

Cada operação tenant-scoped executa dentro de uma transação Prisma que define o tenant na conexão da transação, por exemplo com `set_config('app.restaurante_id', ..., true)`. O valor `true` limita a configuração à transação. As políticas comparam `restaurante_id` ao valor de contexto e negam acesso quando o contexto estiver ausente.

Nenhuma consulta tenant-scoped deve ocorrer fora dessa transação/contexto. Isso precisa ser encapsulado em um provider/repositório compartilhado e coberto por testes de integração, inclusive sob pool de conexões.

Migrações usam credencial distinta da credencial de runtime. Webhooks, workers e tarefas internas devem estabelecer contexto tenant explícito antes de acessar dados do restaurante. Qualquer processo privilegiado deve ter escopo mínimo, autenticação própria, trilha de auditoria e não ser reutilizável por requisições públicas.

## 5. Modelo de dados

Todos os campos `created_at` e `updated_at` são `TIMESTAMPTZ` em UTC. `updated_at` é atualizado pelo serviço ou por mecanismo consistente do banco. Enums abaixo são conceituais; nomes finais podem seguir a convenção Prisma adotada.

### 5.1 Restaurante e acesso

| Entidade | Campos e regras principais |
|---|---|
| `restaurantes` | `id`, `nome`, `slug` único normalizado, `ativo`, telefone/WhatsApp, dados de endereço da unidade, timestamps. Slugs reservados e caracteres inválidos são rejeitados. Desativar em vez de apagar. |
| `usuarios` | `id`, `restaurante_id`, nome, e-mail normalizado, `senha_hash`, papel `OWNER/MANAGER/ATTENDANT`, ativo, timestamps. `UNIQUE(restaurante_id, email)`. |
| `convites_usuario` | tenant, e-mail, papel, token de convite armazenado como hash, expiração, criador, consumo e timestamps. Token de uso único. |
| `sessoes_usuario` | usuário e tenant, hash do refresh token, expiração, revogação, rotação e metadados mínimos do dispositivo. Nunca armazenar refresh token em texto claro. |
| `configuracoes_restaurante` | tenant e configurações operacionais tipadas: modalidades habilitadas, prazo de expiração, opções de pagamento e parâmetros de notificação. Evitar JSON arbitrário para dados que precisam de validação ou consulta. |
| `horarios_funcionamento` | tenant, dia da semana, hora de abertura/fechamento e estado ativo; suportar intervalos que cruzam meia-noite com validação explícita. Pedidos agendados e exceções por feriado ficam fora do MVP. |

### 5.2 Catálogo

| Entidade | Campos e regras principais |
|---|---|
| `categorias` | tenant, nome, ordem, ativo. Produtos podem ser desativados quando a categoria é removida, ou ficar sem categoria conforme política do serviço; não apagar histórico. |
| `produtos` | tenant, categoria opcional, tipo `NORMAL` ou `SABOR_PIZZA`, nome, descrição, imagem, disponível, timestamps. Preço não fica neste registro quando depende de tamanho. |
| `tamanhos_pizza` | tenant, nome, quantidade de sabores permitida (MVP: meio a meio = 2), ordem, ativo. |
| `precos_produto_tamanho` | tenant, produto/sabor, tamanho e preço. `UNIQUE(restaurante_id, produto_id, tamanho_id)`, preço não negativo. Para pizza, representa o preço do sabor naquele tamanho. |
| `grupos_adicionais` | tenant, nome, descrição, ativo. Grupos podem ser reutilizados em produtos. |
| `itens_adicional` | tenant, grupo, nome, preço adicional não negativo, disponível e ordem. |
| `produto_grupo_adicionais` | tenant, produto, grupo, obrigatório, mínimo, máximo e ordem; `UNIQUE(restaurante_id, produto_id, grupo_id)`. Validar `0 <= minimo <= maximo`. As regras de seleção são por produto, não globais ao grupo. |
| `bairros_entrega` | tenant, nome normalizado, taxa fixa não negativa, ativo. Nome único por restaurante. O pedido guarda snapshot do nome e da taxa. |

### 5.3 Cliente e privacidade

| Entidade | Campos e regras principais |
|---|---|
| `clientes` | tenant, nome, telefone normalizado, timestamps e estado de anonimização. `UNIQUE(restaurante_id, telefone)` enquanto identificável. Cliente é isolado por restaurante; telefone não é credencial. |
| `enderecos_cliente` | tenant, cliente, rótulo opcional, rua, número, complemento, bairro/localidade e referência, endereço padrão, timestamps. Vários endereços por cliente e no máximo um padrão, garantido por transação/índice parcial. |
| `tokens_dispositivo_cliente` | tenant, cliente, hash de token aleatório de alta entropia, expiração, revogação e timestamps. Token bruto é entregue uma vez em cookie `HttpOnly`, `Secure`, com política `SameSite` compatível com o subdomínio; nunca é recuperável a partir do telefone. Rotação e revogação são suportadas. |

Endpoints não permitem procurar um cliente e expor nome/endereço somente pelo número de telefone. Um cliente convidado pode fazer pedido sem token; nesse caso, as informações são digitadas no pedido e não se concede acesso ao CRM.

O pedido guarda snapshots de contato/entrega independentes do perfil para preservar operação e relatórios. **Remover o registro `clientes` não remove os snapshots do pedido.** Isso, isoladamente, não equivale à eliminação de todos os dados pessoais para fins de LGPD. O backend deve permitir anonimizar snapshots pessoais sem apagar totais, itens e dados financeiros necessários, conforme política de retenção e orientação jurídica definida antes da produção.

### 5.4 Pedidos, itens e pagamentos

| Entidade | Campos e regras principais |
|---|---|
| `contador_pedidos` | tenant e próximo número. Incremento atômico dentro da transação que cria o pedido. Reinício diário não faz parte do MVP. |
| `pedidos` | tenant, UUID, número sequencial por restaurante, origem `WEB` ou `PDV`, cliente opcional, snapshots de nome/telefone, entrega `DELIVERY/RETIRADA`, snapshots de endereço/bairro, forma de pagamento, subtotal, taxa, total, observação, status, timestamps e chave de idempotência. Número único por tenant. |
| `pedido_itens` | tenant, pedido, referências opcionais aos produtos/tamanho, quantidade positiva, preço unitário cobrado, nome/descrição/tamanho/preços em snapshot, identificadores/snapshots de sabor 1 e sabor 2 para pizza meio a meio, observação e total de linha. Produto pode ser removido do catálogo sem apagar o item histórico. |
| `pedido_item_adicionais` | tenant, item do pedido, referência opcional ao adicional, nome e preço unitário em snapshot, quantidade e total. |
| `pagamentos` | tenant, pedido, forma, provedor opcional (`ASAAS` no MVP), status independente do pedido, valor/moeda BRL, referência externa, dados de expiração, datas e metadados mínimos. Não armazenar segredo do gateway aqui. |
| `credenciais_gateway` | tenant, provedor, credencial cifrada, estado de validação, timestamps e metadados não secretos. Chave de API Asaas é cifrada em repouso por chave mestra mantida fora do banco (secret manager/KMS ou segredo de ambiente operacional); nunca retornar o segredo em API/logs. |
| `eventos_status_pedido` | tenant, pedido, status anterior/novo, ator (usuário/sistema), motivo e instante. Append-only para auditoria operacional. |
| `webhook_inbox` | tabela técnica de entrada, sem tenant antes da resolução da referência externa; provedor, identificador de evento, referência do pagamento, recebido/processado, resultado e timestamps. Acesso restrito ao processador de webhook, chave única idempotente por provedor/evento e payload sensível mínimo. Após localizar o pagamento, o processamento passa a ser tenant-scoped. |

Valores são recalculados no servidor com os preços atuais válidos no momento da criação e persistidos em snapshots. O cliente nunca é autoridade para preço, taxa, total, status de pagamento ou tenant.

### 5.5 Notificações

| Entidade | Campos e regras principais |
|---|---|
| `inscricoes_push` | tenant, audiência (`RESTAURANTE` ou `CLIENTE`), referência do usuário/cliente quando aplicável, endpoint e chaves Web Push protegidos, ativo e timestamps. Endpoint único e revogável. |
| `outbox_eventos` | tenant opcional quando evento global, tipo, referência, payload mínimo, estado de processamento, tentativas, próxima tentativa e timestamps. Inserido na mesma transação da mudança que originou a notificação. |

Push é best-effort. O serviço remove inscrições definitivamente inválidas (por exemplo, respostas equivalentes a 404/410 do serviço push), aplica retentativas limitadas e não bloqueia a criação/atualização do pedido. Conteúdo da notificação não deve expor telefone ou endereço.

## 6. Regras de pedidos e estados

### 6.1 Estado do pedido

Estados sugeridos:

- `AGUARDANDO_ACEITE`: pedido web recebido, ainda não aceito pelo restaurante.
- `ACEITO`: restaurante aceitou e pode iniciar operação.
- `EM_PREPARO`.
- `PRONTO_RETIRADA`: pedido de retirada pronto.
- `SAIU_PARA_ENTREGA`: pedido de delivery saiu.
- `CONCLUIDO`.
- `RECUSADO`.
- `CANCELADO`.
- `EXPIRADO`.

Transições válidas:

| Origem | Próximos estados permitidos |
|---|---|
| `AGUARDANDO_ACEITE` | `ACEITO`, `RECUSADO`, `CANCELADO`, `EXPIRADO` |
| `ACEITO` | `EM_PREPARO`, `CANCELADO` (somente usuário autorizado e com motivo) |
| `EM_PREPARO` | `PRONTO_RETIRADA` para retirada; `SAIU_PARA_ENTREGA` para delivery; `CANCELADO` com motivo e autorização |
| `PRONTO_RETIRADA` | `CONCLUIDO`, `CANCELADO` com motivo |
| `SAIU_PARA_ENTREGA` | `CONCLUIDO`, `CANCELADO` com motivo |
| Estados terminais | sem transição, exceto correção administrativa auditada |

Pedidos de PDV são criados diretamente como `ACEITO`, com usuário de origem obrigatório. Pedidos web entram como `AGUARDANDO_ACEITE`. Atualizações de status usam transação, controle de concorrência e gravam `eventos_status_pedido`.

### 6.2 Estado de pagamento

Forma de pagamento: `PIX_MANUAL`, `PIX_ASAAS`, `DINHEIRO`, `CARTAO_CREDITO` ou `CARTAO_DEBITO`. Cartão no MVP é pagamento presencial/na entrega; o backend não coleta nem processa dados de cartão.

Estado de pagamento independente:

- `AGUARDANDO_CONFIRMACAO_MANUAL`: Pix manual informado; o PDV exibe que o lojista precisa confirmar recebimento.
- `AGUARDANDO_CRIACAO_GATEWAY` e `AGUARDANDO_PAGAMENTO`: Pix Asaas em criação ou aguardando confirmação.
- `PAGO`, `FALHOU`, `EXPIRADO`, `CANCELADO`, `ESTORNO_PENDENTE`, `ESTORNADO`, conforme aplicável.
- Para pagamento presencial, estados apropriados são `A_PAGAR` e `PAGO`.

Pix manual: o restaurante cadastra chave Pix própria (CPF/CNPJ/celular/e-mail/aleatória, normalizada e validada conforme tipo). A API pública retorna instruções de pagamento, não confirma recebimento. Usuário autorizado confirma ou rejeita manualmente; a ação gera auditoria. Não há tarifa de gateway do SaaS neste fluxo; eventuais tarifas da instituição financeira do lojista seguem as condições da conta dele.

Pix Asaas: no checkout, o pedido fica aguardando aceite. Após o aceite, o serviço cria cobrança na conta conectada do restaurante, armazena a referência externa e entrega ao cliente QR/copia-e-cola e expiração. O pedido não é marcado pago até confirmação válida. Gateway, processamento do webhook e atualizações são idempotentes.

Recusa/cancelamento/expiração do pedido encerra ou cancela a cobrança conforme a capacidade do provedor. Caso já esteja pago, não se promete estorno automático no MVP; registrar situação e encaminhar ação manual ao restaurante. O status do pedido não deve ser inferido diretamente do evento externo sem validar pagamento, valor, moeda, tenant, referência e estado atual.

### 6.3 Cálculo e validação do pedido

- Quantidade deve ser maior que zero; preços e taxas nunca negativos.
- `subtotal` é a soma dos totais das linhas; `valor_total = subtotal + taxa_entrega`.
- Delivery exige modalidade habilitada, endereço completo e bairro ativo pertencente ao tenant. A taxa aplicada é copiada para o pedido.
- Retirada exige modalidade habilitada e não recebe taxa de entrega.
- Dinheiro pode conter `troco_para`, que precisa ser maior ou igual ao total; outras formas não aceitam troco.
- Produto, tamanho, sabores e adicionais precisam estar ativos/disponíveis e pertencer ao mesmo tenant no instante da criação.
- Pizza meio a meio exige tipo pizza, tamanho compatível e dois sabores válidos do mesmo tenant. O preço base é o maior preço dos dois sabores para o tamanho escolhido. O tamanho e ambos os sabores ficam nos snapshots. A quantidade máxima de sabores é respeitada.
- Mínimo/máximo e disponibilidade de cada grupo de adicionais são validados pelo servidor. Adicionais selecionados e preço são copiados no pedido.
- Pedidos web são aceitos apenas dentro do horário operacional, respeitando fuso `America/Sao_Paulo`; exceções/feriados e agendamento não fazem parte do MVP.
- Pedidos usam `Idempotency-Key` para impedir duplicação em retries de rede. A mesma chave com payload diferente retorna conflito.

## 7. Pix e padrão Adapter

Contrato interno conceitual:

```text
PaymentProvider
  createPixCharge(order, restaurantCredentials) -> charge
  getCharge(providerReference, restaurantCredentials) -> chargeStatus
  cancelCharge(providerReference, restaurantCredentials) -> result
  validateWebhook(headers, rawBody, restaurantConfiguration) -> verifiedEvent
```

`ManualPixProvider` entrega instruções e nunca confirma pagamento automaticamente. `AsaasAdapter` encapsula autenticação, criação/consulta/cancelamento de cobrança, validação de webhook, conversão de estados e erros de transporte. Mercado Pago poderá implementar o mesmo contrato no futuro sem alterar `OrderModule` ou o modelo conceitual do core.

O endpoint de webhook não confia em `restaurante_id` recebido no corpo. Valida o token compartilhado Asaas e guarda somente os campos mínimos na `webhook_inbox`, com chave única por provedor/evento. Um worker assíncrono usa `WEBHOOK_DATABASE_URL`, conexão da role restrita `saasfood_webhook`, para consumir a inbox; a referência externa é resolvida por uma função `SECURITY DEFINER` com proprietário não-login `saasfood_webhook_resolver` e privilégio `BYPASSRLS`, concedida somente à role do webhook. Após resolver o pagamento, o worker consulta o estado diretamente ao provedor e processa em transação tenant-scoped, com comparação do valor/moeda/referência. Expiração/cancelamento da cobrança cancela o pedido somente se ainda estiver `ACEITO`, registrando evento de auditoria; pagamento e pedido mantêm estados independentes nos demais casos. Webhooks duplicados são sucesso idempotente; eventos inválidos são rejeitados sem expor segredos.

As roles `saasfood_webhook` e `saasfood_webhook_resolver` devem ser provisionadas pelo operador do PostgreSQL antes de aplicar a migration do resolvedor; a URL dedicada não deve usar a credencial da aplicação.

## 8. Autorização

| Ação | OWNER | MANAGER | ATTENDANT |
|---|---:|---:|---:|
| Consultar pedidos e atualizar preparo/entrega | Sim | Sim | Sim |
| Confirmar Pix manual | Sim | Sim | Sim, sujeito à configuração do restaurante |
| CRUD de produtos, categorias e adicionais | Sim | Sim | Não |
| CRUD de bairros, horários e configurações | Sim | Sim | Não |
| Conectar/alterar credencial Asaas ou chave Pix | Sim | Não | Não |
| Convidar/desativar usuários | Sim | Sim, sem conceder papel OWNER | Não |
| Alterar papel OWNER ou desativar proprietário | Sim, com proteção contra remover o último OWNER | Não | Não |
| Consultar auditoria | Sim | Sim | Somente eventos operacionais necessários |

Todas as regras são verificadas no servidor. Ocultar botões no futuro frontend não substitui autorização.

## 9. API REST inicial

Todas as rotas ficam sob `/api/v1`. JSON em UTF-8. Respostas monetárias serializam valores decimais como strings para evitar arredondamento do cliente. Erros têm formato estável com `statusCode`, `code`, `message`, `requestId` e detalhes de validação sem stack trace ou segredo.

### 9.1 Pública do restaurante e cardápio

- `GET /public/restaurant`: resumo público do tenant, modalidades, horários e instruções Pix manual sem dados privados.
- `GET /public/catalog`: categorias, produtos disponíveis, tamanhos, preços e adicionais permitidos.
- `POST /public/orders`: cria pedido web; valida preços e disponibilidade no servidor; suporta `Idempotency-Key`.
- `GET /public/orders/:trackingToken`: consulta status mínimo usando token aleatório privado, não UUID sequencial nem telefone.
- `POST /public/orders/:trackingToken/cancel`: cancela somente enquanto aguardando aceite.
- `POST /public/customers/device-token`: cria/rotaciona token de acesso ao perfil no dispositivo após pedido; define cookie seguro.
- `GET /public/customer/profile`, `PATCH /public/customer/profile`: consulta/atualiza perfil autorizado pelo cookie-token.
- `GET /public/customer/addresses`, `POST /public/customer/addresses`, `PATCH /public/customer/addresses/:id`, `DELETE /public/customer/addresses/:id`: gerenciamento de endereços sob o mesmo token.
- `POST /public/push-subscriptions`, `DELETE /public/push-subscriptions`: inscrição voluntária e revogação de Web Push do cliente.

O backend nunca oferece endpoint público `GET customer by phone`. A criação do pedido como convidado não exige login, OTP nem token de dispositivo.

O token de acompanhamento é um segredo bearer: deve ter alta entropia, ser armazenado como hash, ter validade/revogação definidas e não ser incluído em logs, analytics ou cabeçalho `Referer`. A resposta contém somente os dados mínimos do pedido.

### 9.2 Autenticação e painel/PDV

- `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`.
- `POST /auth/forgot-password`, `POST /auth/reset-password`.
- `POST /auth/accept-invitation`.
- `GET /me`.
- `GET/POST/PATCH /restaurant/users` e ações de convite/desativação conforme permissões.
- CRUD de categorias, produtos, tamanhos, preços, grupos, adicionais e bairros sob `/restaurant/...`.
- `GET /restaurant/orders`, `GET /restaurant/orders/:id`, `POST /restaurant/orders/:id/accept`, `/reject`, `/status`, `/cancel`.
- `POST /restaurant/orders/:id/payments/manual/confirm` e `/reject`.
- `POST /restaurant/orders/:id/payments/asaas` cria/reconsulta a cobrança Pix de um pedido já aceito, permitindo retry seguro quando o provedor estiver temporariamente indisponível.
- `POST /restaurant/orders` para pedido de PDV; cria como aceito, com ator autenticado e origem `PDV`.
- `GET/PATCH /restaurant/settings`, configuração de modalidades, horários e prazos.
- `PUT /restaurant/payment-settings/manual-pix` e `PUT /restaurant/payment-settings/asaas`; segredos são escritos, nunca devolvidos.
- `POST /restaurant/push-subscriptions`, `DELETE /restaurant/push-subscriptions`.
- `GET /restaurant/audit-events` conforme papel.

### 9.3 Integração

- `POST /webhooks/asaas`: rota pública de provedor, autenticada e idempotente. Payload bruto fica limitado em tamanho e é processado sem assumir tenant do corpo.
- `GET /health/live` e `GET /health/ready`: liveness e dependências essenciais; não expor detalhes internos sem autenticação.

Os DTOs são validados (ex.: `class-validator` ou padrão único equivalente), com whitelist e rejeição de propriedades inesperadas. Paginação é cursor-based ou limitada, ordenação explícita, limites máximos e filtros tenant-scoped.

## 10. Expiração e processamento assíncrono

- Prazos para aceite e pagamento são configuráveis por restaurante, com limites mínimos/máximos globais para prevenir valores abusivos.
- Um worker periódico busca registros expirados com lock/claim atômico, executa transições idempotentes, cancela cobrança quando aplicável e gera evento de status.
- Alteração de pedido, evento outbox e histórico de status são gravados na mesma transação.
- Envio de Web Push ocorre fora da transação. Falhas são retentadas com limite/backoff; esgotadas ficam observáveis em logs/monitoramento.
- Push de status ao cliente só ocorre se houve inscrição e consentimento explícitos. Mudanças de status também estão disponíveis pelo link privado de acompanhamento.

## 11. Índices e restrições mínimas

- Índices de tenant para todas as FKs e consultas operacionais.
- `UNIQUE(slug)` para restaurante; não criar índice duplicado.
- `UNIQUE(restaurante_id, email)` em usuários; `UNIQUE(restaurante_id, telefone)` em clientes identificáveis.
- `UNIQUE(restaurante_id, numero_pedido)` e unicidade de chaves de idempotência no escopo definido.
- Pedidos: índice `(restaurante_id, status, created_at DESC)`.
- Itens: índice `(restaurante_id, pedido_id)`. Adicionais e eventos indexados pelo pedido.
- Webhooks: unicidade `(provedor, identificador_evento)` na `webhook_inbox`; índice da referência externa. A tabela técnica de entrada tem acesso restrito e não é consultável por endpoints de tenant.
- Todas as FKs de dados tenant-scoped devem garantir tenant correspondente; não confiar somente em validação de serviço.
- Restrições `CHECK`: quantidades positivas, preços/taxas não negativos, `minimo <= maximo` e regras simples que não dependam de outras linhas.
- Exclusão de restaurante não é operação normal. Dados transacionais são preservados; catálogo e usuários são desativados/arquivados. `ON DELETE CASCADE` não deve apagar pedidos históricos.

## 12. Segurança, privacidade e observabilidade

- TLS obrigatório fora de desenvolvimento; CORS por allowlist de domínios.
- Cookies seguros, proteção CSRF quando cookies autenticam requisições mutáveis, política de origem e rate limit em login, recuperação, criação/consulta pública e webhooks.
- Segredos e credenciais de gateway nunca aparecem em resposta, logs, métricas ou rastros. Criptografia de credenciais em repouso e rotação documentada.
- Logs estruturados com `requestId`, tenant, ator e ação; evitar telefone, endereço, token, chave Pix completa, JWT e payload integral de pagamento.
- Auditoria para transições de pedido, confirmação manual, configurações de pagamento, usuários e alterações relevantes.
- Retenção e anonimização devem ser configuráveis e documentadas. Preservar totais e linhas financeiras ao anonimizar dados pessoais dos snapshots, quando permitido pela política aprovada.
- Endpoints e notificações limitam os dados pessoais retornados ao mínimo necessário.

## 13. Requisitos não funcionais

- Início como monólito modular stateless, executável em mais de uma instância.
- Banco PostgreSQL é a fonte de verdade; não depender de memória de processo para sessão, locks ou deduplicação.
- Migrações versionadas, reversíveis quando viável e testadas contra banco limpo e versão anterior.
- Timeouts e retentativas limitadas para provedores externos; circuit breaking pode ser adicionado quando houver evidência de necessidade.
- Valores, datas e fuso têm semântica explícita: instantes UTC no banco; horário comercial avaliado em `America/Sao_Paulo`.
- Configuração por ambiente; nenhum segredo ou credencial de produção no repositório.

## 14. Testes e critérios de aceite

### Testes obrigatórios

1. Unitários para cálculo de subtotal, taxa, meio a meio, adicionais, troco e transições.
2. Integração com PostgreSQL real para constraints, FKs compostas, migrations e RLS.
3. Testes negativos entre dois tenants para cada módulo: leitura, escrita, associação de produto/adicional, endereço e pedido.
4. Teste de conexão/pool assegurando que o contexto RLS não vaza entre transações.
5. Testes de autorização para cada papel.
6. Testes de idempotência para criar pedido, confirmar pagamento e processar webhook duplicado/concorrente.
7. Testes do AsaasAdapter com sandbox ou respostas simuladas contratualmente, sem depender de rede em testes unitários.
8. Testes para token privado do pedido e token do cliente: aleatoriedade, expiração, rotação, revogação e rejeição de consulta apenas por telefone.
9. Testes de outbox, push indisponível, retries limitados e remoção de inscrições inválidas.
10. Teste de anonimização mantendo totais, produtos em snapshot e relatórios agregados.

### Critérios de aceite do MVP backend

- Uma requisição de um tenant não consegue ler, alterar ou relacionar dados de outro tenant, inclusive com IDs válidos obtidos externamente.
- Catálogo pode ser gerenciado e exposto sem revelar produtos indisponíveis.
- Pedidos WEB e PDV calculam valores no servidor e preservam snapshots.
- Pedidos seguem transições válidas, geram histórico e não se duplicam em retry.
- Pix manual apresenta instruções e exige confirmação explícita do lojista.
- Pix Asaas é criado após aceite, confirma por webhook idempotente e não marca pago com evento não validado.
- Endereços do cliente não podem ser recuperados por telefone; acesso de conveniência requer token do dispositivo.
- Push é opcional, revogável e não bloqueia o fluxo de pedidos.
- API OpenAPI cobre rotas, autenticação, DTOs e erros.
- Aplicação, banco e migrations podem ser iniciados/testados em ambiente de desenvolvimento documentado.

## 15. Fora do MVP

- Cobrança da assinatura do SaaS.
- Auto cadastro público de restaurantes.
- Várias unidades/filiais por restaurante.
- Papéis personalizados, MFA obrigatório e conta de usuário compartilhada entre restaurantes.
- Login/conta obrigatória ou OTP para cliente.
- Pagamentos online de cartão, split de pagamentos, repasses pelo SaaS e estornos automáticos.
- Outros gateways além do Asaas e Pix manual.
- WhatsApp, SMS e notificações por outros canais.
- Agendamento de pedidos, feriados/exceções complexas e gestão de estoque por quantidade/ingredientes.
- Aplicativos nativos; Push depende de suporte do navegador e consentimento.

## 16. Decisões pendentes antes da implementação

1. Aprovar o fluxo operacional final de Pix Asaas: pedido aguarda aceite antes de criar cobrança; definir se o restaurante pode iniciar preparo antes da confirmação de pagamento ou apenas depois.
2. Definir prazo padrão e limites permitidos para aceite, pagamento e expiração, além do comportamento em pedido pago cujo restaurante não consegue atender.
3. Confirmar provedor de e-mail transacional para convites e recuperação de senha.
4. Escolher hospedagem do PostgreSQL, armazenamento S3-compatible, gestão da chave de criptografia e política de backup/restore.
5. Formalizar política LGPD de retenção, anonimização dos snapshots de pedido e prazo de guarda financeira antes de produção.
6. Definir processo de conexão e validação da chave Asaas por restaurante, inclusive rotação e desconexão.
