# Lista del primer bloque
primer_bloque = [
    58720, 59065, 60053, 62121, 62183, 62206, 62208, 62215, 62234, 62235,
    62299, 62304, 62309, 62326, 62342, 62354, 62398, 62409, 62411, 62423,
    62444, 62460, 62472, 62490, 62522, 62549, 62580, 62582, 62630, 62691,
    62709, 62719, 62796, 62852, 62861, 62942, 62974, 62980
]

# Lista del segundo bloque
segundo_bloque = [
    62490, 62411, 62423, 62206, 62235, 62183, 62719, 62942, 62444, 62342,
    58720, 62409, 62472, 62582, 62326, 62208, 62215, 62398, 62630, 62974,
    60053, 62299, 62304, 62309, 62460, 62549, 62234, 62354, 62709, 62980,
    62852, 62852, 59065, 62121, 62522, 62580, 62691, 62796, 62861
]

# Encontrar cuáles del segundo bloque NO están en el primero
diferencia = [codigo for codigo in segundo_bloque if codigo not in primer_bloque]

print("Códigos del segundo bloque que NO están en el primero:")
print(diferencia)
