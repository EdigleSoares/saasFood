-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "papel_usuario" AS ENUM ('OWNER', 'MANAGER', 'ATTENDANT');

-- CreateEnum
CREATE TYPE "tipo_produto" AS ENUM ('NORMAL', 'SABOR_PIZZA');

-- CreateEnum
CREATE TYPE "dia_semana" AS ENUM ('SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO');

-- CreateEnum
CREATE TYPE "tipo_entrega" AS ENUM ('DELIVERY', 'RETIRADA');

-- CreateEnum
CREATE TYPE "origem_pedido" AS ENUM ('WEB', 'PDV');

-- CreateEnum
CREATE TYPE "status_pedido" AS ENUM ('AGUARDANDO_ACEITE', 'ACEITO', 'EM_PREPARO', 'PRONTO_RETIRADA', 'SAIU_PARA_ENTREGA', 'CONCLUIDO', 'RECUSADO', 'CANCELADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "forma_pagamento" AS ENUM ('PIX_MANUAL', 'PIX_ASAAS', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO');

-- CreateEnum
CREATE TYPE "provedor_pagamento" AS ENUM ('ASAAS', 'MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "status_pagamento" AS ENUM ('A_PAGAR', 'AGUARDANDO_CONFIRMACAO_MANUAL', 'AGUARDANDO_CRIACAO_GATEWAY', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'FALHOU', 'EXPIRADO', 'CANCELADO', 'ESTORNO_PENDENTE', 'ESTORNADO');

-- CreateEnum
CREATE TYPE "tipo_ator_evento" AS ENUM ('USUARIO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "audiencia_push" AS ENUM ('RESTAURANTE', 'CLIENTE');

-- CreateEnum
CREATE TYPE "status_outbox" AS ENUM ('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'FALHA');

-- CreateEnum
CREATE TYPE "status_webhook" AS ENUM ('RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'FALHA', 'REJEITADO');

-- CreateTable
CREATE TABLE "restaurantes" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "telefone" VARCHAR(20),
    "whatsapp" VARCHAR(20),
    "endereco_rua" VARCHAR(150),
    "endereco_numero" VARCHAR(20),
    "endereco_complemento" VARCHAR(100),
    "endereco_bairro" VARCHAR(100),
    "endereco_cidade" VARCHAR(100),
    "endereco_estado" CHAR(2),
    "endereco_cep" VARCHAR(9),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "restaurantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "papel" "papel_usuario" NOT NULL DEFAULT 'ATTENDANT',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites_usuario" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "papel" "papel_usuario" NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "criado_por_usuario_id" UUID NOT NULL,
    "consumido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes_usuario" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "revogada_em" TIMESTAMPTZ(6),
    "rotacionada_para_id" UUID,
    "dispositivo" VARCHAR(255),
    "endereco_ip_hash" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessoes_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacao_senha" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "consumido_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_recuperacao_senha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_restaurante" (
    "restaurante_id" UUID NOT NULL,
    "delivery_habilitado" BOOLEAN NOT NULL DEFAULT true,
    "retirada_habilitada" BOOLEAN NOT NULL DEFAULT true,
    "prazo_aceite_minutos" INTEGER NOT NULL DEFAULT 10,
    "prazo_pagamento_minutos" INTEGER NOT NULL DEFAULT 15,
    "aceitar_pix_manual" BOOLEAN NOT NULL DEFAULT false,
    "aceitar_pix_asaas" BOOLEAN NOT NULL DEFAULT false,
    "aceitar_dinheiro" BOOLEAN NOT NULL DEFAULT true,
    "aceitar_cartao_credito" BOOLEAN NOT NULL DEFAULT true,
    "aceitar_cartao_debito" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "configuracoes_restaurante_pkey" PRIMARY KEY ("restaurante_id")
);

-- CreateTable
CREATE TABLE "configuracoes_pix_manual" (
    "restaurante_id" UUID NOT NULL,
    "tipo_chave" VARCHAR(20) NOT NULL,
    "chave_cifrada" TEXT NOT NULL,
    "nome_recebedor" VARCHAR(120),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "configuracoes_pix_manual_pkey" PRIMARY KEY ("restaurante_id")
);

-- CreateTable
CREATE TABLE "horarios_funcionamento" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "dia_semana" "dia_semana" NOT NULL,
    "abre_as" TIME(0) NOT NULL,
    "fecha_as" TIME(0) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "horarios_funcionamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "categoria_id" UUID,
    "tipo" "tipo_produto" NOT NULL DEFAULT 'NORMAL',
    "nome" VARCHAR(100) NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(12,2),
    "imagem_key" TEXT,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tamanhos_pizza" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "quantidade_max_sabores" INTEGER NOT NULL DEFAULT 2,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tamanhos_pizza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precos_produto_tamanho" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "tamanho_id" UUID NOT NULL,
    "preco" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "precos_produto_tamanho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupos_adicionais" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grupos_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_adicional" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "grupo_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "preco" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "itens_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_grupo_adicionais" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "grupo_id" UUID NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "minimo" INTEGER NOT NULL DEFAULT 0,
    "maximo" INTEGER NOT NULL DEFAULT 1,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "produto_grupo_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bairros_entrega" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "nome_normalizado" VARCHAR(100) NOT NULL,
    "taxa_entrega" DECIMAL(12,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bairros_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "nome" VARCHAR(100),
    "telefone" VARCHAR(20),
    "anonimizado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enderecos_cliente" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "bairro_id" UUID,
    "rotulo" VARCHAR(40),
    "cep" VARCHAR(9),
    "rua" VARCHAR(150) NOT NULL,
    "numero" VARCHAR(20) NOT NULL,
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100) NOT NULL,
    "cidade" VARCHAR(100),
    "estado" CHAR(2),
    "referencia" VARCHAR(100),
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enderecos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_dispositivo_cliente" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "revogado_em" TIMESTAMPTZ(6),
    "rotacionado_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_dispositivo_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contador_pedidos" (
    "restaurante_id" UUID NOT NULL,
    "proximo_numero" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contador_pedidos_pkey" PRIMARY KEY ("restaurante_id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "numero_pedido" BIGINT NOT NULL,
    "origem" "origem_pedido" NOT NULL,
    "criado_por_usuario_id" UUID,
    "cliente_id" UUID,
    "nome_contato_snapshot" VARCHAR(100),
    "telefone_snapshot" VARCHAR(20),
    "tipo_entrega" "tipo_entrega" NOT NULL,
    "bairro_id" UUID,
    "bairro_snapshot" VARCHAR(100),
    "taxa_entrega" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "endereco_rua_snapshot" VARCHAR(150),
    "endereco_numero_snapshot" VARCHAR(20),
    "endereco_complemento_snapshot" VARCHAR(100),
    "endereco_referencia_snapshot" VARCHAR(100),
    "endereco_cep_snapshot" VARCHAR(9),
    "endereco_cidade_snapshot" VARCHAR(100),
    "endereco_estado_snapshot" CHAR(2),
    "forma_pagamento" "forma_pagamento" NOT NULL,
    "troco_para" DECIMAL(12,2),
    "subtotal" DECIMAL(12,2) NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "status" "status_pedido" NOT NULL DEFAULT 'AGUARDANDO_ACEITE',
    "observacao" TEXT,
    "idempotency_key" VARCHAR(128),
    "payload_hash" VARCHAR(128),
    "tracking_token_hash" VARCHAR(255),
    "expira_aceite_em" TIMESTAMPTZ(6),
    "expira_pagamento_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_itens" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "produto_id" UUID,
    "tamanho_id" UUID,
    "sabor1_id" UUID,
    "sabor2_id" UUID,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "nome_produto_snapshot" VARCHAR(100) NOT NULL,
    "descricao_snapshot" TEXT,
    "tamanho_snapshot" VARCHAR(60),
    "sabor1_snapshot" VARCHAR(100),
    "sabor2_snapshot" VARCHAR(100),
    "preco_sabor1_snapshot" DECIMAL(12,2),
    "preco_sabor2_snapshot" DECIMAL(12,2),
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "total_linha" DECIMAL(12,2) NOT NULL,
    "observacao" VARCHAR(255),

    CONSTRAINT "pedido_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_item_adicionais" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "pedido_item_id" UUID NOT NULL,
    "item_adicional_id" UUID,
    "nome_snapshot" VARCHAR(60) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "total_linha" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "pedido_item_adicionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "forma" "forma_pagamento" NOT NULL,
    "provedor" "provedor_pagamento",
    "status" "status_pagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "moeda" CHAR(3) NOT NULL DEFAULT 'BRL',
    "referencia_externa" VARCHAR(150),
    "copia_e_cola" TEXT,
    "qr_code_imagem" TEXT,
    "expira_em" TIMESTAMPTZ(6),
    "pago_em" TIMESTAMPTZ(6),
    "cancelado_em" TIMESTAMPTZ(6),
    "metadados" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credenciais_gateway" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "provedor" "provedor_pagamento" NOT NULL,
    "credencial_cifrada" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "validada_em" TIMESTAMPTZ(6),
    "ultimo_erro_codigo" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credenciais_gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_status_pedido" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "ator_tipo" "tipo_ator_evento" NOT NULL,
    "ator_usuario_id" UUID,
    "status_anterior" "status_pedido",
    "status_novo" "status_pedido" NOT NULL,
    "motivo" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_status_pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL,
    "provedor" "provedor_pagamento" NOT NULL,
    "identificador_evento" VARCHAR(180) NOT NULL,
    "referencia_externa" VARCHAR(150),
    "status" "status_webhook" NOT NULL DEFAULT 'RECEBIDO',
    "payload" JSONB,
    "recebido_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMPTZ(6),
    "resultado" VARCHAR(255),

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscricoes_push" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID NOT NULL,
    "audiencia" "audiencia_push" NOT NULL,
    "usuario_id" UUID,
    "cliente_id" UUID,
    "endpoint" TEXT NOT NULL,
    "chave_publica_cifrada" TEXT NOT NULL,
    "chave_auth_cifrada" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_envio_em" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inscricoes_push_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_eventos" (
    "id" UUID NOT NULL,
    "restaurante_id" UUID,
    "tipo" VARCHAR(100) NOT NULL,
    "agregado_tipo" VARCHAR(80) NOT NULL,
    "agregado_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "status_outbox" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMPTZ(6),
    "processado_em" TIMESTAMPTZ(6),
    "ultimo_erro" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurantes_slug_key" ON "restaurantes"("slug");

-- CreateIndex
CREATE INDEX "usuarios_restaurante_id_ativo_idx" ON "usuarios"("restaurante_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_restaurante_id_email_key" ON "usuarios"("restaurante_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_restaurante_id_id_key" ON "usuarios"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "convites_usuario_token_hash_key" ON "convites_usuario"("token_hash");

-- CreateIndex
CREATE INDEX "convites_usuario_restaurante_id_email_expira_em_idx" ON "convites_usuario"("restaurante_id", "email", "expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_usuario_refresh_token_hash_key" ON "sessoes_usuario"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "sessoes_usuario_restaurante_id_usuario_id_expira_em_idx" ON "sessoes_usuario"("restaurante_id", "usuario_id", "expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_recuperacao_senha_token_hash_key" ON "tokens_recuperacao_senha"("token_hash");

-- CreateIndex
CREATE INDEX "tokens_recuperacao_senha_restaurante_id_usuario_id_expira_e_idx" ON "tokens_recuperacao_senha"("restaurante_id", "usuario_id", "expira_em");

-- CreateIndex
CREATE INDEX "horarios_funcionamento_restaurante_id_dia_semana_ativo_idx" ON "horarios_funcionamento"("restaurante_id", "dia_semana", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "horarios_funcionamento_restaurante_id_dia_semana_abre_as_key" ON "horarios_funcionamento"("restaurante_id", "dia_semana", "abre_as");

-- CreateIndex
CREATE INDEX "categorias_restaurante_id_ativo_ordem_idx" ON "categorias"("restaurante_id", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_restaurante_id_id_key" ON "categorias"("restaurante_id", "id");

-- CreateIndex
CREATE INDEX "produtos_restaurante_id_categoria_id_idx" ON "produtos"("restaurante_id", "categoria_id");

-- CreateIndex
CREATE INDEX "produtos_restaurante_id_disponivel_ativo_idx" ON "produtos"("restaurante_id", "disponivel", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "produtos_restaurante_id_id_key" ON "produtos"("restaurante_id", "id");

-- CreateIndex
CREATE INDEX "tamanhos_pizza_restaurante_id_ativo_ordem_idx" ON "tamanhos_pizza"("restaurante_id", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "tamanhos_pizza_restaurante_id_id_key" ON "tamanhos_pizza"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tamanhos_pizza_restaurante_id_nome_key" ON "tamanhos_pizza"("restaurante_id", "nome");

-- CreateIndex
CREATE INDEX "precos_produto_tamanho_restaurante_id_tamanho_id_idx" ON "precos_produto_tamanho"("restaurante_id", "tamanho_id");

-- CreateIndex
CREATE UNIQUE INDEX "precos_produto_tamanho_restaurante_id_produto_id_tamanho_id_key" ON "precos_produto_tamanho"("restaurante_id", "produto_id", "tamanho_id");

-- CreateIndex
CREATE INDEX "grupos_adicionais_restaurante_id_ativo_idx" ON "grupos_adicionais"("restaurante_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "grupos_adicionais_restaurante_id_id_key" ON "grupos_adicionais"("restaurante_id", "id");

-- CreateIndex
CREATE INDEX "itens_adicional_restaurante_id_grupo_id_disponivel_ordem_idx" ON "itens_adicional"("restaurante_id", "grupo_id", "disponivel", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "itens_adicional_restaurante_id_id_key" ON "itens_adicional"("restaurante_id", "id");

-- CreateIndex
CREATE INDEX "produto_grupo_adicionais_restaurante_id_grupo_id_idx" ON "produto_grupo_adicionais"("restaurante_id", "grupo_id");

-- CreateIndex
CREATE UNIQUE INDEX "produto_grupo_adicionais_restaurante_id_produto_id_grupo_id_key" ON "produto_grupo_adicionais"("restaurante_id", "produto_id", "grupo_id");

-- CreateIndex
CREATE INDEX "bairros_entrega_restaurante_id_ativo_idx" ON "bairros_entrega"("restaurante_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "bairros_entrega_restaurante_id_id_key" ON "bairros_entrega"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bairros_entrega_restaurante_id_nome_normalizado_key" ON "bairros_entrega"("restaurante_id", "nome_normalizado");

-- CreateIndex
CREATE INDEX "clientes_restaurante_id_created_at_idx" ON "clientes"("restaurante_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_restaurante_id_id_key" ON "clientes"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_restaurante_id_telefone_key" ON "clientes"("restaurante_id", "telefone");

-- CreateIndex
CREATE INDEX "enderecos_cliente_restaurante_id_cliente_id_idx" ON "enderecos_cliente"("restaurante_id", "cliente_id");

-- CreateIndex
CREATE INDEX "enderecos_cliente_restaurante_id_bairro_id_idx" ON "enderecos_cliente"("restaurante_id", "bairro_id");

-- CreateIndex
CREATE UNIQUE INDEX "enderecos_cliente_restaurante_id_id_key" ON "enderecos_cliente"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_dispositivo_cliente_token_hash_key" ON "tokens_dispositivo_cliente"("token_hash");

-- CreateIndex
CREATE INDEX "tokens_dispositivo_cliente_restaurante_id_cliente_id_expira_idx" ON "tokens_dispositivo_cliente"("restaurante_id", "cliente_id", "expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_tracking_token_hash_key" ON "pedidos"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "pedidos_restaurante_id_status_created_at_idx" ON "pedidos"("restaurante_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pedidos_restaurante_id_cliente_id_created_at_idx" ON "pedidos"("restaurante_id", "cliente_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pedidos_restaurante_id_bairro_id_idx" ON "pedidos"("restaurante_id", "bairro_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_restaurante_id_id_key" ON "pedidos"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_restaurante_id_numero_pedido_key" ON "pedidos"("restaurante_id", "numero_pedido");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_restaurante_id_idempotency_key_key" ON "pedidos"("restaurante_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "pedido_itens_restaurante_id_pedido_id_idx" ON "pedido_itens"("restaurante_id", "pedido_id");

-- CreateIndex
CREATE INDEX "pedido_itens_restaurante_id_produto_id_idx" ON "pedido_itens"("restaurante_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_itens_restaurante_id_id_key" ON "pedido_itens"("restaurante_id", "id");

-- CreateIndex
CREATE INDEX "pedido_item_adicionais_restaurante_id_pedido_item_id_idx" ON "pedido_item_adicionais"("restaurante_id", "pedido_item_id");

-- CreateIndex
CREATE INDEX "pedido_item_adicionais_restaurante_id_item_adicional_id_idx" ON "pedido_item_adicionais"("restaurante_id", "item_adicional_id");

-- CreateIndex
CREATE INDEX "pagamentos_restaurante_id_pedido_id_created_at_idx" ON "pagamentos"("restaurante_id", "pedido_id", "created_at");

-- CreateIndex
CREATE INDEX "pagamentos_restaurante_id_status_expira_em_idx" ON "pagamentos"("restaurante_id", "status", "expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_restaurante_id_id_key" ON "pagamentos"("restaurante_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_restaurante_id_provedor_referencia_externa_key" ON "pagamentos"("restaurante_id", "provedor", "referencia_externa");

-- CreateIndex
CREATE INDEX "credenciais_gateway_restaurante_id_ativa_idx" ON "credenciais_gateway"("restaurante_id", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "credenciais_gateway_restaurante_id_provedor_key" ON "credenciais_gateway"("restaurante_id", "provedor");

-- CreateIndex
CREATE INDEX "eventos_status_pedido_restaurante_id_pedido_id_created_at_idx" ON "eventos_status_pedido"("restaurante_id", "pedido_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_inbox_provedor_referencia_externa_idx" ON "webhook_inbox"("provedor", "referencia_externa");

-- CreateIndex
CREATE INDEX "webhook_inbox_status_recebido_em_idx" ON "webhook_inbox"("status", "recebido_em");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_provedor_identificador_evento_key" ON "webhook_inbox"("provedor", "identificador_evento");

-- CreateIndex
CREATE UNIQUE INDEX "inscricoes_push_endpoint_key" ON "inscricoes_push"("endpoint");

-- CreateIndex
CREATE INDEX "inscricoes_push_restaurante_id_audiencia_ativa_idx" ON "inscricoes_push"("restaurante_id", "audiencia", "ativa");

-- CreateIndex
CREATE INDEX "inscricoes_push_restaurante_id_usuario_id_idx" ON "inscricoes_push"("restaurante_id", "usuario_id");

-- CreateIndex
CREATE INDEX "inscricoes_push_restaurante_id_cliente_id_idx" ON "inscricoes_push"("restaurante_id", "cliente_id");

-- CreateIndex
CREATE INDEX "outbox_eventos_status_proxima_tentativa_em_created_at_idx" ON "outbox_eventos"("status", "proxima_tentativa_em", "created_at");

-- CreateIndex
CREATE INDEX "outbox_eventos_restaurante_id_agregado_tipo_agregado_id_idx" ON "outbox_eventos"("restaurante_id", "agregado_tipo", "agregado_id");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_usuario" ADD CONSTRAINT "convites_usuario_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites_usuario" ADD CONSTRAINT "convites_usuario_restaurante_id_criado_por_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "criado_por_usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_usuario" ADD CONSTRAINT "sessoes_usuario_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_usuario" ADD CONSTRAINT "sessoes_usuario_restaurante_id_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes_usuario" ADD CONSTRAINT "sessoes_usuario_rotacionada_para_id_fkey" FOREIGN KEY ("rotacionada_para_id") REFERENCES "sessoes_usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacao_senha" ADD CONSTRAINT "tokens_recuperacao_senha_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_recuperacao_senha" ADD CONSTRAINT "tokens_recuperacao_senha_restaurante_id_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_restaurante" ADD CONSTRAINT "configuracoes_restaurante_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_pix_manual" ADD CONSTRAINT "configuracoes_pix_manual_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horarios_funcionamento" ADD CONSTRAINT "horarios_funcionamento_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_restaurante_id_categoria_id_fkey" FOREIGN KEY ("restaurante_id", "categoria_id") REFERENCES "categorias"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tamanhos_pizza" ADD CONSTRAINT "tamanhos_pizza_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precos_produto_tamanho" ADD CONSTRAINT "precos_produto_tamanho_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precos_produto_tamanho" ADD CONSTRAINT "precos_produto_tamanho_restaurante_id_produto_id_fkey" FOREIGN KEY ("restaurante_id", "produto_id") REFERENCES "produtos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precos_produto_tamanho" ADD CONSTRAINT "precos_produto_tamanho_restaurante_id_tamanho_id_fkey" FOREIGN KEY ("restaurante_id", "tamanho_id") REFERENCES "tamanhos_pizza"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos_adicionais" ADD CONSTRAINT "grupos_adicionais_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_adicional" ADD CONSTRAINT "itens_adicional_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_adicional" ADD CONSTRAINT "itens_adicional_restaurante_id_grupo_id_fkey" FOREIGN KEY ("restaurante_id", "grupo_id") REFERENCES "grupos_adicionais"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_grupo_adicionais" ADD CONSTRAINT "produto_grupo_adicionais_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_grupo_adicionais" ADD CONSTRAINT "produto_grupo_adicionais_restaurante_id_produto_id_fkey" FOREIGN KEY ("restaurante_id", "produto_id") REFERENCES "produtos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_grupo_adicionais" ADD CONSTRAINT "produto_grupo_adicionais_restaurante_id_grupo_id_fkey" FOREIGN KEY ("restaurante_id", "grupo_id") REFERENCES "grupos_adicionais"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bairros_entrega" ADD CONSTRAINT "bairros_entrega_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos_cliente" ADD CONSTRAINT "enderecos_cliente_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos_cliente" ADD CONSTRAINT "enderecos_cliente_restaurante_id_cliente_id_fkey" FOREIGN KEY ("restaurante_id", "cliente_id") REFERENCES "clientes"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enderecos_cliente" ADD CONSTRAINT "enderecos_cliente_restaurante_id_bairro_id_fkey" FOREIGN KEY ("restaurante_id", "bairro_id") REFERENCES "bairros_entrega"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_dispositivo_cliente" ADD CONSTRAINT "tokens_dispositivo_cliente_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_dispositivo_cliente" ADD CONSTRAINT "tokens_dispositivo_cliente_restaurante_id_cliente_id_fkey" FOREIGN KEY ("restaurante_id", "cliente_id") REFERENCES "clientes"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contador_pedidos" ADD CONSTRAINT "contador_pedidos_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_criado_por_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "criado_por_usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_cliente_id_fkey" FOREIGN KEY ("restaurante_id", "cliente_id") REFERENCES "clientes"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_restaurante_id_bairro_id_fkey" FOREIGN KEY ("restaurante_id", "bairro_id") REFERENCES "bairros_entrega"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_pedido_id_fkey" FOREIGN KEY ("restaurante_id", "pedido_id") REFERENCES "pedidos"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_produto_id_fkey" FOREIGN KEY ("restaurante_id", "produto_id") REFERENCES "produtos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_tamanho_id_fkey" FOREIGN KEY ("restaurante_id", "tamanho_id") REFERENCES "tamanhos_pizza"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_sabor1_id_fkey" FOREIGN KEY ("restaurante_id", "sabor1_id") REFERENCES "produtos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_restaurante_id_sabor2_id_fkey" FOREIGN KEY ("restaurante_id", "sabor2_id") REFERENCES "produtos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item_adicionais" ADD CONSTRAINT "pedido_item_adicionais_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item_adicionais" ADD CONSTRAINT "pedido_item_adicionais_restaurante_id_pedido_item_id_fkey" FOREIGN KEY ("restaurante_id", "pedido_item_id") REFERENCES "pedido_itens"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item_adicionais" ADD CONSTRAINT "pedido_item_adicionais_restaurante_id_item_adicional_id_fkey" FOREIGN KEY ("restaurante_id", "item_adicional_id") REFERENCES "itens_adicional"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_restaurante_id_pedido_id_fkey" FOREIGN KEY ("restaurante_id", "pedido_id") REFERENCES "pedidos"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credenciais_gateway" ADD CONSTRAINT "credenciais_gateway_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_status_pedido" ADD CONSTRAINT "eventos_status_pedido_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_status_pedido" ADD CONSTRAINT "eventos_status_pedido_restaurante_id_pedido_id_fkey" FOREIGN KEY ("restaurante_id", "pedido_id") REFERENCES "pedidos"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_status_pedido" ADD CONSTRAINT "eventos_status_pedido_restaurante_id_ator_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "ator_usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricoes_push" ADD CONSTRAINT "inscricoes_push_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricoes_push" ADD CONSTRAINT "inscricoes_push_restaurante_id_usuario_id_fkey" FOREIGN KEY ("restaurante_id", "usuario_id") REFERENCES "usuarios"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricoes_push" ADD CONSTRAINT "inscricoes_push_restaurante_id_cliente_id_fkey" FOREIGN KEY ("restaurante_id", "cliente_id") REFERENCES "clientes"("restaurante_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_eventos" ADD CONSTRAINT "outbox_eventos_restaurante_id_fkey" FOREIGN KEY ("restaurante_id") REFERENCES "restaurantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Application roles must not own these tables or have BYPASSRLS.
-- Provision saasfood_app and saasfood_webhook as restricted runtime roles outside this migration.
DO $$
DECLARE
    tenant_table TEXT;
    tenant_tables TEXT[] := ARRAY[
        'usuarios',
        'convites_usuario',
        'sessoes_usuario',
        'tokens_recuperacao_senha',
        'configuracoes_restaurante',
        'configuracoes_pix_manual',
        'horarios_funcionamento',
        'categorias',
        'produtos',
        'tamanhos_pizza',
        'precos_produto_tamanho',
        'grupos_adicionais',
        'itens_adicional',
        'produto_grupo_adicionais',
        'bairros_entrega',
        'clientes',
        'enderecos_cliente',
        'tokens_dispositivo_cliente',
        'contador_pedidos',
        'pedidos',
        'pedido_itens',
        'pedido_item_adicionais',
        'pagamentos',
        'credenciais_gateway',
        'eventos_status_pedido',
        'inscricoes_push'
    ];
BEGIN
    FOREACH tenant_table IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format(
            $policy$CREATE POLICY tenant_isolation ON %I USING (restaurante_id = NULLIF(current_setting('app.restaurante_id', true), '')::uuid) WITH CHECK (restaurante_id = NULLIF(current_setting('app.restaurante_id', true), '')::uuid)$policy$,
            tenant_table
        );
    END LOOP;
END $$;

ALTER TABLE "outbox_eventos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_eventos" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_or_worker_outbox ON "outbox_eventos"
    USING (
        (restaurante_id = NULLIF(current_setting('app.restaurante_id', true), '')::uuid)
        OR (restaurante_id IS NULL AND current_user = 'saasfood_worker')
    )
    WITH CHECK (
        (restaurante_id = NULLIF(current_setting('app.restaurante_id', true), '')::uuid)
        OR (restaurante_id IS NULL AND current_user = 'saasfood_worker')
    );

ALTER TABLE "webhook_inbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_inbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_worker_only ON "webhook_inbox"
    USING (current_user = 'saasfood_webhook')
    WITH CHECK (current_user = 'saasfood_webhook');

-- Checks that Prisma's schema language cannot express.
ALTER TABLE "configuracoes_restaurante"
    ADD CONSTRAINT "configuracoes_restaurante_prazos_check"
    CHECK (prazo_aceite_minutos BETWEEN 1 AND 1440 AND prazo_pagamento_minutos BETWEEN 1 AND 1440);
ALTER TABLE "horarios_funcionamento"
    ADD CONSTRAINT "horarios_funcionamento_intervalo_check"
    CHECK (abre_as <> fecha_as);
ALTER TABLE "tamanhos_pizza"
    ADD CONSTRAINT "tamanhos_pizza_quantidade_sabores_check"
    CHECK (quantidade_max_sabores BETWEEN 1 AND 2);
ALTER TABLE "produtos"
    ADD CONSTRAINT "produtos_preco_nao_negativo_check"
    CHECK (preco IS NULL OR preco >= 0),
    ADD CONSTRAINT "produtos_tipo_preco_check"
    CHECK (
        (tipo = 'NORMAL' AND preco IS NOT NULL)
        OR (tipo = 'SABOR_PIZZA' AND preco IS NULL)
    );
ALTER TABLE "precos_produto_tamanho"
    ADD CONSTRAINT "precos_produto_tamanho_preco_check"
    CHECK (preco >= 0);
ALTER TABLE "itens_adicional"
    ADD CONSTRAINT "itens_adicional_preco_check"
    CHECK (preco >= 0);
ALTER TABLE "produto_grupo_adicionais"
    ADD CONSTRAINT "produto_grupo_adicionais_limites_check"
    CHECK (
        minimo >= 0
        AND maximo >= minimo
        AND (NOT obrigatorio OR minimo > 0)
    );
ALTER TABLE "bairros_entrega"
    ADD CONSTRAINT "bairros_entrega_taxa_check"
    CHECK (taxa_entrega >= 0);
ALTER TABLE "pedidos"
    ADD CONSTRAINT "pedidos_valores_check"
    CHECK (
        subtotal >= 0
        AND taxa_entrega >= 0
        AND valor_total >= 0
        AND valor_total = subtotal + taxa_entrega
        AND (troco_para IS NULL OR troco_para >= valor_total)
        AND (tipo_entrega <> 'RETIRADA' OR taxa_entrega = 0)
    ),
    ADD CONSTRAINT "pedidos_delivery_endereco_check"
    CHECK (
        tipo_entrega <> 'DELIVERY'
        OR (
            endereco_rua_snapshot IS NOT NULL
            AND endereco_numero_snapshot IS NOT NULL
            AND bairro_snapshot IS NOT NULL
        )
    );
ALTER TABLE "pedido_itens"
    ADD CONSTRAINT "pedido_itens_quantidade_preco_check"
    CHECK (quantidade > 0 AND preco_unitario >= 0 AND total_linha >= 0);
ALTER TABLE "pedido_item_adicionais"
    ADD CONSTRAINT "pedido_item_adicionais_quantidade_preco_check"
    CHECK (quantidade > 0 AND preco_unitario >= 0 AND total_linha >= 0);
ALTER TABLE "pagamentos"
    ADD CONSTRAINT "pagamentos_valor_check"
    CHECK (valor >= 0 AND moeda = 'BRL');
ALTER TABLE "outbox_eventos"
    ADD CONSTRAINT "outbox_eventos_tentativas_check"
    CHECK (tentativas >= 0);
ALTER TABLE "inscricoes_push"
    ADD CONSTRAINT "inscricoes_push_alvo_check"
    CHECK (
        (audiencia = 'RESTAURANTE' AND usuario_id IS NOT NULL AND cliente_id IS NULL)
        OR (audiencia = 'CLIENTE' AND cliente_id IS NOT NULL AND usuario_id IS NULL)
    );

-- Only one default address per customer. The predicate is intentionally partial.
CREATE UNIQUE INDEX "enderecos_cliente_um_padrao_idx"
    ON "enderecos_cliente" ("restaurante_id", "cliente_id")
    WHERE "padrao" = true;

-- Keep queue scans small and prevent repeatedly scanning completed work.
CREATE INDEX "outbox_eventos_pendentes_idx"
    ON "outbox_eventos" ("proxima_tentativa_em", "created_at")
    WHERE "status" IN ('PENDENTE', 'FALHA');
CREATE INDEX "webhook_inbox_pendentes_idx"
    ON "webhook_inbox" ("recebido_em")
    WHERE "status" IN ('RECEBIDO', 'FALHA');
