/**
 * =============================================================================
 * HERMES - Musteri Select'i icin logolu satir (antd optionRender/labelRender)
 * =============================================================================
 * Secenekler DUZ kalir ({ value: id, label: ad }) — arama (`optionFilterProp
 * ="label"`) ve testler metin uzerinden calisir; logo yalniz cizimde eklenir.
 * Kullanim: <Select options={...} {...customerSelectRender} />
 * =============================================================================
 */
import { CustomerLogo } from '../liquid'

function CustomerOptionRow({ id, label, size = 20 }) {
    return (
        <span className="lq-copt">
            <CustomerLogo id={id} name={typeof label === "string" ? label : ""} size={size} />
            <span className="lq-copt__label">{label}</span>
        </span>
    )
}

export const customerSelectRender = {
    optionRender: (option) => <CustomerOptionRow id={option.value} label={option.label} />,
    labelRender: ({ value, label }) => <CustomerOptionRow id={value} label={label} size={18} />,
}
