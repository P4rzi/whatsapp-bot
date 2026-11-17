import { describe, expect, it } from "vitest";
import { classifyInbound, phoneVariants } from "./classify";

const opt = (t: string) => classifyInbound(t, "TEXT");

describe("pedido para parar de receber", () => {
  it.each([
    "SAIR",
    "sair",
    "Parar.",
    "pare!",
    "stop",
    "Não quero mais receber essas mensagens",
    "nao quero receber",
    "para de me mandar mensagem",
    "parem de me cobrar por aqui",
    "não me mande mais isso",
    "me tira dessa lista",
    "Remove meu número do cadastro por favor",
    "quero me descadastrar",
    "isso é spam",
    "vou te bloquear",
    "gostaria de sair",
  ])("%s", (t) => expect(opt(t)).toBe("OPT_OUT"));
});

describe("aviso de pagamento", () => {
  it.each([
    "já paguei",
    "Ja paguei ontem",
    "paguei agora a pouco",
    "acabei de fazer o pix",
    "acabei de transferir",
    "Pix feito!",
    "pagamento realizado",
    "tá pago",
    "segue o comprovante",
    "já foi pago, obrigado",
    "Eu quitei semana passada",
    "fiz o pix agora",
    "mandei o comprovante e o pix",
  ])("%s", (t) => expect(opt(t)).toBe("PAYMENT_CLAIM"));

  it("PDF sem texto é tratado como provável comprovante", () => {
    expect(classifyInbound(null, "DOCUMENT")).toBe("PAYMENT_CLAIM");
  });
});

describe("outras mensagens (sem falso alarme)", () => {
  it.each([
    "quem é?",
    "Oi, bom dia",
    "ainda não paguei, pago sexta",
    "nao paguei ainda",
    "vou pagar amanhã",
    "pago dia 10",
    "parece que o valor está errado",
    "me manda a chave pix?",
    "obrigado!",
    "👍",
    "pode parcelar?",
    "vou fazer o pix mais tarde",
    "consigo pagar só semana que vem",
  ])("%s", (t) => expect(opt(t)).toBe("OTHER"));

  it("áudio, imagem e figurinha sem texto ficam como outras (conferir no celular)", () => {
    expect(classifyInbound(null, "AUDIO")).toBe("OTHER");
    expect(classifyInbound("", "IMAGE")).toBe("OTHER");
    expect(classifyInbound(null, "STICKER")).toBe("OTHER");
  });

  it("legenda da imagem conta", () => {
    expect(classifyInbound("comprovante", "IMAGE")).toBe("PAYMENT_CLAIM");
  });
});

describe("variações do número (9º dígito)", () => {
  it("celular com 9 também casa sem o 9, e vice-versa", () => {
    expect(phoneVariants("5511987654321").sort()).toEqual(["551187654321", "5511987654321"]);
    expect(phoneVariants("551187654321").sort()).toEqual(["551187654321", "5511987654321"]);
  });
  it("fixo (começa com 2-5) não ganha 9; estrangeiro fica igual", () => {
    expect(phoneVariants("551134567890")).toEqual(["551134567890"]);
    expect(phoneVariants("14155552671")).toEqual(["14155552671"]);
  });
});
