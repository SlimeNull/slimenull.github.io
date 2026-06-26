---
title: '高级 JSON 序列化, 基于反射和动态代理将复杂的, 带循环引用的, 多态的数据序列化与反序列化'
published: 2026-06-26
description: '基于反射和动态代理将复杂的, 带循环引用的, 多态的数据序列化与反序列化. 通过自定义转换器, 实现几乎任意数据类型的序列化与反序列化.'
image: ''
tags: ['C#', 'JSON']
category: ''
draft: false 
lang: ''
---

你的领导突然要你做跨进程的插件开发, 但项目已经有一套 API 抽象了,
你不希望重新再抽一套, 于是决定将原有进程内插件的复杂数据抽象, 序列化成 JSON, 再通过命名管道发送到另一个进程.
但问题是, 这套数据是复杂的, 带循环引用的, 多态的, 基于接口的. 并且你不希望再接受短再写一次接口的实现类.

> 本文基于 System.Text.Json, 并且需要使用 Castle.Core 中的动态代理

## 如何解决循环引用

假如你有两个类型:

```cs
class A { public B Other { get; set; } }
class B { public A Other { get; set; } }
```

它们明显互相引用, 但你希望能够正确的序列化它, 那么使用 System.Text.Json 中的 ReferenceHandler.Preserve 可以轻易解决这个需求.

在 JsonSerialzierOptions 中指定 ReferenceHandler, 你就可以直接跑通下面明显带有循环引用的对象序列化了

```cs
using System.Text.Json;
using System.Text.Json.Serialization;

var a = new A();
var b = new B();
a.Other = b;
b.Other = a;

var jsonSerializerOptions = new JsonSerializerOptions()
{
    ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.Preserve
};

var json = JsonSerializer.Serialize(a, jsonSerializerOptions);
Console.WriteLine(json)
```

它将输出:

```json
{"$id":"1","Other":{"$id":"2","Other":{"$ref":"1"}}}
```

当然, 你也可以将它重新序列化到 C# 对象, 对象引用关系仍然存在:

```cs
var objRoot = JsonSerializer.Deserialize<A>(json, jsonSerializerOptions);
Console.WriteLine(objRoot.GetHashCode());
Console.WriteLine(objRoot.Other.Other.GetHashCode());
```

由于两个对象是同一个对象, 上述两个 `Console.WriteLine` 输出的哈希值是相同的.

`ReferenceHandler` 是一个抽象类, 它包含一个 `CreateResolver` 方法, 用来创建一个实际存储容器, 它用来添加引用或从存储中取得引用.

当 JSON 反序列化的时候, 遇到 `$id` 节点, 它就会将它加入到 `ReferenceResolver` 中, 在后续遇到 `$ref` 节点时, 再从中取出.

## 自定义 ReferenceHandler 以保证多个序列化调用使用同一引用存储

JSON 反序列化的时候, 如果我们使用了自定义的转换器, 即便当前对象是前面对象的引用, System.Text.Json 也会调用我们的转换器.

这会导致在我们在自定义转换器中使用 `Utf8JsonReader` 读取到的节点只是一个带有 `$ref` 属性的空节点, 但在转换其中, 我们还没办法拿到 `ReferenceHolder` 来手动解析对象引用.
并且, 即便我们不手动通过 `reader` 解析, 而是在转换器内继续调用 `JsonSerializer.Deserialize` 并传入原有 `reader`, `typeToConvert` 和 `option`, 由于这是两次调用, 它也没办法成功解析引用.

所以: 我们需要自己定义一个 ReferenceHandler`, 以做到:

1. 使其在多次 `Deserialize` 调用中能够共享引用解析存储
2. 能够让我们自己的转换器解析引用

所以, 我们需要创建一个和 `ReferenceHandler.Preserve` 行为一致的, 但是多次调用 `CreateResolver` 时只返回同意对象的实现. 并且为了避免反序列化的时候拿到 "上一次反序列化" 时加入的引用, 它还应当有 `Reset` 方法用于重置存储.

> 文档参考: [如何在 System.Text.Json 中保留引用并处理或忽略循环引用](https://learn.microsoft.com/zh-cn/dotnet/standard/serialization/system-text-json/preserve-references)

```cs
class PreserveReferenceResolver : ReferenceResolver
{
    private uint _referenceCount;
    private readonly Dictionary<string, object> _referenceIdToObjectMap = [];
    private readonly Dictionary<object, string> _objectToReferenceIdMap = new (ReferenceEqualityComparer.Instance);

    public override void AddReference(string referenceId, object value)
    {
        if (!_referenceIdToObjectMap.TryAdd(referenceId, value))
        {
            throw new JsonException();
        }
    }

    public override string GetReference(object value, out bool alreadyExists)
    {
        if (_objectToReferenceIdMap.TryGetValue(value, out string? referenceId))
        {
            alreadyExists = true;
        }
        else
        {
            _referenceCount++;
            referenceId = _referenceCount.ToString();
            _objectToReferenceIdMap.Add(value, referenceId);
            alreadyExists = false;
        }

        return referenceId;
    }

    public override object ResolveReference(string referenceId)
    {
        if (!_referenceIdToObjectMap.TryGetValue(referenceId, out object? value))
        {
            throw new JsonException();
        }

        return value;
    }
}

class SingletonReferenceHandler : ReferenceHandler
{
    public SingletonReferenceHandler() => Reset();
    private ReferenceResolver? _rootedResolver;
    public override ReferenceResolver CreateResolver() => _rootedResolver!;
    public void Reset() => _rootedResolver = new PreserveReferenceResolver();

    public static void AddReferenceIsNecessary(JsonObject jsonObject, object value, JsonSerializerOptions options)
    {
        if (jsonObject.TryGetPropertyValue("$id", out var propertyValueNode) &&
            propertyValueNode is not null &&
            propertyValueNode.GetValueKind() == JsonValueKind.String)
        {
            if (options?.ReferenceHandler is SingletonReferenceHandler referenceHandler)
            {
                referenceHandler.CreateResolver().AddReference(propertyValueNode.GetValue<string>(), value);
            }
            else
            {
                throw new InvalidOperationException("Can not add reference");
            }
        }
    }

    public static bool TryResolveReference(JsonObject jsonObject, JsonSerializerOptions options, [NotNullWhen(true)] out object? value)
    {
        if (jsonObject.TryGetPropertyValue("$ref", out var propertyValueNode) &&
            propertyValueNode is not null &&
            propertyValueNode.GetValueKind() == JsonValueKind.String)
        {
            if (options?.ReferenceHandler is SingletonReferenceHandler referenceHandler)
            {
                value = referenceHandler.CreateResolver().ResolveReference(propertyValueNode.GetValue<string>());
                return true;
            }
            else
            {
                throw new InvalidOperationException("Can not resolve reference");
            }
        }

        value = null;
        return false;
    }
}
```

这样:

1. 在转换器内调用 `Serialize` / `Deserialize` 的时候, 它们共享引用, 就不会出现 id 冲突或者无法解析引用的情况了
2. 在转换器内添加引用或解引用的时候, 调用上面写的静态方法即可.


值得一提的是, 之所以我们不直接在 `SingletonReferenceHandler` 中使用 `ReferenceHandler.Preserve.CreateResolver` 而是自己写一个 resolver 并实例化它,
是因为库自带的 Preserve 实现的 `CreateResolver` 会直接丢给你一个 `InvalidOperation` 异常. 库内部专门判断了 "这个类型是不是我内置的 Handler", 如果是, 它会调用一个 internal 方法.

但既然是 internal, 我们自然无法调用或实现了. 而刚刚提到的 `CreateResolver` 实现, 内部实现就是一句 `throw new InvalidOperationException()`

## 基于动态代理, 在无需实体类的情况下反序列化接口

接下来, 我们需要继续创建一个转换器, 转换器的逻辑是创建一个动态代理对象用来表示接口反序列化的对象. 而代理执行的逻辑, 则是通过从 `reader` 中读出的 `JsonNode`, 继续调用 `Deserialize` 反序列化接口的成员.

```cs
public class InterfaceProxyConverter : JsonConverter<object>
{
    public List<Type> TypesToProxy { get; } = new List<Type>();
    public List<Assembly> TypeLookupAssemblies { get; } = new();

    public override bool CanConvert(Type typeToConvert)
    {
        if (!typeToConvert.IsInterface)
        {
            return false;
        }

        foreach (var typeToProxy in TypesToProxy)
        {
            if (typeToProxy.IsAssignableFrom(typeToConvert))
            {
                return true;
            }
        }

        return false;
    }

    private class InterfaceInterceptor : IInterceptor
    {
        private readonly Type _targetInterface;
        private readonly JsonObject _payload;
        private readonly JsonSerializerOptions _deserializeOptions;

        private readonly Dictionary<string, object?> _propertyCache = new Dictionary<string, object?>();

        public InterfaceInterceptor(Type targetInterface, JsonObject payload, JsonSerializerOptions deserializeOptions)
        {
            _targetInterface = targetInterface;
            _payload = payload;
            _deserializeOptions = deserializeOptions;
        }

        private static bool IsPropertyGetInvocation(IInvocation invocation, out string propertyName)
        {
            propertyName = null!;

            var method = invocation.Method;

            if (!method.IsSpecialName ||
                !method.Name.StartsWith("get_", StringComparison.Ordinal) ||
                method.GetParameters().Length != 0 ||
                method.ReturnType == typeof(void))
            {
                return false;
            }

            propertyName = method.Name.Substring("get_".Length);
            return propertyName.Length > 0;
        }

        private object? VisitProperty(string propertyName, Type propertyType)
        {
            if (_propertyCache.TryGetValue(propertyName, out var cachedValue))
            {
                return cachedValue;
            }

            if (!_payload.TryGetPropertyValue(propertyName, out var propertyValueNode))
            {
                return null;
            }

            var createdValue = JsonSerializer.Deserialize(propertyValueNode, propertyType, _deserializeOptions);
            _propertyCache[propertyName] = createdValue;

            return createdValue;
        }

        public void WallAllProperties()
        {
            var interfaceProperties = _targetInterface.GetInterfaces()
                .Append(_targetInterface)
                .SelectMany(inter => inter.GetProperties())
                .DistinctBy(prop => prop.Name)
                .ToArray();

            foreach (var property in interfaceProperties)
            {
                VisitProperty(property.Name, property.PropertyType);
            }
        }

        public void Intercept(IInvocation invocation)
        {
            if (!IsPropertyGetInvocation(invocation, out var propertyName))
            {
                return;
            }

            invocation.ReturnValue = VisitProperty(propertyName, invocation.Method.ReturnType);
        }
    }

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return null;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return referenceValue;
        }

        if (payload.TryGetPropertyValue("$type", out var typeJson) &&
            typeJson is not null &&
            typeJson.GetValueKind() == JsonValueKind.String)
        {
            typeToConvert = TypeLookupAssemblies
                .Select(asm => asm.GetType(typeJson.GetValue<string>()))
                .Where(t => t is not null)
                .First()!;
        }

        var proxyGenerator = new ProxyGenerator();
        var interceptor = new InterfaceInterceptor(typeToConvert, payload, options);
        var proxy = proxyGenerator.CreateInterfaceProxyWithoutTarget(typeToConvert, interceptor);
        SingletonReferenceHandler.AddReferenceIsNecessary(payload, proxy, options);

        interceptor.WallAllProperties();

        return proxy;
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        throw new NotSupportedException();
    }
}
```


## 大量自定义类型的自定义转换

你的项目中可能定义了大量的基本数据类型, 例如 double2, int3x3 这类表示向量或矩阵的类型. 但幸运的是, 它们都有静态的 `Parse` 方法.

非常好, 这样我们就可以用一个转换器基于反射解决它们的序列化和反序列化了.

```cs
public class CommonParseConverter : JsonConverter<object>
{
    private static readonly Type[] _requiredParseMethodParameters = new[] { typeof(string) };
    private readonly Dictionary<Type, MethodInfo?> _parseMethods = new Dictionary<Type, MethodInfo?>();

    private static MethodInfo? FindParseMethod(Type type)
        => type.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, null, _requiredParseMethodParameters, null);

    public override bool CanConvert(Type typeToConvert)
    {
        if (Nullable.GetUnderlyingType(typeToConvert) is { } nullableActualType)
        {
            typeToConvert = nullableActualType;
        }

        if (typeToConvert == typeof(bool) ||
            typeToConvert == typeof(decimal) ||
            typeToConvert == typeof(string) ||
            typeToConvert == typeof(DateTime) ||
            typeToConvert == typeof(DateTimeOffset) ||
            typeToConvert == typeof(Guid) ||
            typeToConvert == typeof(TimeSpan) ||
            typeToConvert == typeof(Uri) ||
            typeToConvert == typeof(Version) ||
            typeToConvert.IsEnum ||
            typeToConvert.IsPrimitive)
        {
            return false;
        }

        if (!_parseMethods.TryGetValue(typeToConvert, out var parseMethod))
        {
            _parseMethods[typeToConvert] = parseMethod = FindParseMethod(typeToConvert);
        }

        return parseMethod is not null;
    }

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        if (reader.TokenType != JsonTokenType.String)
        {
            throw new JsonException($"Expected string token, but got {reader.TokenType}.");
        }

        if (Nullable.GetUnderlyingType(typeToConvert) is { } nullableActualType)
        {
            typeToConvert = nullableActualType;
        }

        var text = reader.GetString()!;
        return _parseMethods[typeToConvert]!.Invoke(null, new object[] { text });
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        if (value is IConvertible convertible)
        {
            writer.WriteStringValue(convertible.ToString(CultureInfo.InvariantCulture));
        }
        else
        {
            writer.WriteStringValue(value.ToString());
        }
    }
}
```

上面的转换器支持任意带有静态 Parse(string) 的类型.

## 自动处理类型和接口多态

System.Text.Json 原生支持多态序列化和反序列化, 但是要求你往目标基类上添加特性标记

```cs
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$discriminator")]
[JsonDerivedType(typeof(ThreeDimensionalPoint), typeDiscriminator: "3d")]
public class BasePoint { }
```

使用自定义类型转换器, 自己写入类型名称到 `$type` 属性, 并且反序列化的时候自己读, 就可以实现在不添加特性的情况下自动处理多态了.

```cs
public class AutoPolymorphicConverter<T> : JsonConverter<T>
    where T : class
{
    public bool IsForInterface { get; set; }
    public List<Assembly> TypeLookupAssemblies { get; } = new();

    public override bool CanConvert(Type typeToConvert)
        => typeToConvert == typeof(T);

    private static Type FindMaxInterface(Type type)
    {
        var maxInterface = typeof(T);
        var typeInterfaces = type.GetInterfaces();

        bool continueIterate = true;
        while (continueIterate)
        {
            continueIterate = false;
            foreach (var typeInterface in typeInterfaces)
            {
                if (typeInterface != maxInterface &&
                    maxInterface.IsAssignableFrom(typeInterface))
                {
                    maxInterface = typeInterface;
                    continueIterate = true;
                }
            }
        }

        return maxInterface;
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        var finalType = IsForInterface ?
            FindMaxInterface(value.GetType()) :
            value.GetType();

        var node = JsonSerializer.SerializeToNode(value, finalType, options);

        if (node is JsonObject jObj)
        {
            jObj["$type"] = finalType.FullName;
            jObj.WriteTo(writer, options);
        }
        else
        {
            writer.WriteNullValue();
        }
    }

    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return (T)referenceValue;
        }

        if (payload.TryGetPropertyValue("$type", out var typeJson) &&
            typeJson is not null &&
            typeJson.GetValueKind() == JsonValueKind.String)
        {
            typeToConvert = TypeLookupAssemblies
                .Select(asm => asm.GetType(typeJson.GetValue<string>()))
                .Where(t => t is not null)
                .First()!;

            payload.Remove("$type");
        }

        var value = JsonSerializer.Deserialize(payload, typeToConvert, options)!;

        return (T?)value;
    }
}
```

于是, 当你有这样的类型时:

```cs
class A { public string? MemberA { get; set; } public string SomePropertyOnlyInClass => "balabala"; }
class B : A, IB { public string? MemberB { get; set; } }
class C : A, IC { public string? MemberC { get; set; } }

interface IA { public string? MemberA { get; } }
interface IB : IA { public string? MemberB { get; } }
interface IC : IA { public string? MemberC { get; } }
```

就可以这样序列化:

```cs
A a = new C() { MemberA = "abc", MemberC = "def" };
var json = JsonSerializer.Serialize(a, new JsonSerializerOptions()
{
    Converters = 
    {
        new AutoPolymorphicConverter<A>()
    }
});

Console.WriteLine(json);
```

以上代码输出:

```json
{"MemberC":"def","MemberA":"abc","SomePropertyOnlyInClass":"balabala","$type":"C"}
```

如果你想让它自动识别接口, 并仅序列化接口成员, 也可以这么做:

```cs
IA a2 = new C() { MemberA = "abc", MemberC = "def" };
var json2 = JsonSerializer.Serialize(a2, new JsonSerializerOptions()
{
    Converters =
    {
        new AutoPolymorphicConverter<IA>() { IsForInterface = true }
    }
});

Console.WriteLine(json2);
```

以上代码输出

```json
{"MemberC":"def","MemberA":"abc","$type":"IC"}
```

## 自动调用目标类型构造函数

如果你某个类型没有公开的构造函数, 还希望反序列化它, 可以使用 System.Text.Json 中自带的 `JsonConstructor` 特性.

但很遗憾, 这个功能貌似与 `ReferenceHandler` 不兼容. 所以我们需要自己写一个转换器, 用来自动调用带参数的构造函数.

```cs
public class CustomConstructorConverter : JsonConverter<object>
{
    private static ConstructorInfo? FindConstructor(Type type)
    {
        var constructors = type.GetConstructors();

        foreach (var constructor in constructors)
        {
            if (constructor.IsPublic &&
                constructor.GetParameters().Length == 0)
            {
                return null;
            }
        }

        foreach (var constructor in constructors)
        {
            if (constructor.GetCustomAttribute<JsonConstructorAttribute>() is not null)
            {
                return constructor;
            }
        }

        return null;
    }

    private static ParameterInfo? FindParameter(ParameterInfo[] parameters, string parameterName)
    {
        foreach (var parameter in parameters)
        {
            if (string.Equals(parameter.Name, parameterName, StringComparison.OrdinalIgnoreCase))
            {
                return parameter;
            }
        }

        return null;
    }

    public override bool CanConvert(Type typeToConvert)
        => FindConstructor(typeToConvert) != null;

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartObject)
        {
            throw new InvalidOperationException();
        }

        var jObj = JsonNode.Parse(ref reader) as JsonObject;
        if (jObj is null)
            return null;

        if (SingletonReferenceHandler.TryResolveReference(jObj, options, out var referenceValue))
        {
            return referenceValue;
        }

        var constructor = FindConstructor(typeToConvert)!;
        var constructorParameters = constructor.GetParameters();
        var parameterValues = new object?[constructorParameters.Length];
        foreach (var kv in jObj)
        {
            if (FindParameter(constructorParameters, kv.Key) is not { } parameter)
            {
                continue;
            }

            parameterValues[parameter.Position] = JsonSerializer.Deserialize(kv.Value, parameter.ParameterType, options);
        }

        var value = constructor.Invoke(parameterValues);
        SingletonReferenceHandler.AddReferenceIsNecessary(jObj, value, options);

        return value;
    }

    public override void Write(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
    {
        throw new NotSupportedException();
    }
}
```

此转换器只需要加入到解析 options 中的转换器, 就可以为所有没有无参构造的类型, 找到第一个公开构造函数, 并解析 JSON, 然后尝试构造.

值得一提的是, 构造函数的参数名称必须和属性名称一致, 大小写不敏感. 否则转换器无法为构造函数准备参数值.

## 只读集合类型的数据成员填充

如果正常情况下你有一个集合是只读的, 并且你还希望反序列化的时候把成员填充进已有的集合中, 那么使用 `JsonObjectCreationHandling.Populate` 就可以做到.
但是很遗憾, 这个功能同样跟 `ReferenceHandler` 所以又到了我们最喜欢的手搓 JsonConverter 时刻!

```cs
public class AutoPopulateMemberCollectionConverter<T> : JsonConverter<T>
{
    private static void PopulateChildrenIntoCollection(
        object? targetObject,
        JsonArray children,
        JsonSerializerOptions options)
    {
        if (targetObject is null)
            throw new InvalidOperationException("The collection value to populate is null.");

        var targetType = targetObject.GetType();

        // Array / T[]
        if (targetObject is Array array)
        {
            var itemType = targetType.GetElementType()
                ?? throw new InvalidOperationException("Can not determine array element type.");

            if (array.Length < children.Count)
                throw new InvalidOperationException("Array length is insufficient to populate all child elements.");

            for (var i = 0; i < children.Count; i++)
            {
                var value = JsonSerializer.Deserialize(children[i], itemType, options);
                array.SetValue(value, i);
            }

            return;
        }

        // IList<T>
        var collectionInterface = targetType
            .GetInterfaces()
            .Concat(new[] { targetType })
            .FirstOrDefault(t =>
                t.IsGenericType &&
                t.GetGenericTypeDefinition() == typeof(ICollection<>));

        if (collectionInterface is not null)
        {
            var itemType = collectionInterface.GetGenericArguments()[0];

            var isReadOnlyProperty = collectionInterface.GetProperty("IsReadOnly");
            if (isReadOnlyProperty?.GetValue(targetObject) is true)
                throw new InvalidOperationException("The collection to populate is not writable.");

            var addMethod = collectionInterface.GetMethod("Add")
                ?? throw new InvalidOperationException("The collection to populate is not writable.");

            foreach (var item in children)
            {
                var value = JsonSerializer.Deserialize(item, itemType, options);
                addMethod.Invoke(targetObject, new[] { value });
            }

            return;
        }

        // non-generic IList
        if (targetObject is IList list)
        {
            if (list.IsReadOnly || list.IsFixedSize)
                throw new InvalidOperationException("The collection to populate is not writable.");

            foreach (var item in children)
            {
                var value = JsonSerializer.Deserialize<object>(item, options);
                list.Add(value);
            }

            return;
        }

        throw new InvalidOperationException("The object to populate is not a writable collection.");
    }

    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
        {
            return default;
        }

        var node = JsonNode.Parse(ref reader);

        if (node is not JsonObject payload)
        {
            throw new JsonException($"Expected JSON object for interface type '{typeToConvert}'.");
        }

        if (SingletonReferenceHandler.TryResolveReference(payload, options, out var referenceValue))
        {
            return (T?)referenceValue;
        }

        var subOptions = new JsonSerializerOptions(options);
        subOptions.Converters.Remove(this);

        var value = (T?)JsonSerializer.Deserialize(payload, typeToConvert, subOptions);

        if (value is { })
        {
            var actualType = value.GetType();
            foreach (var property in actualType.GetProperties())
            {
                if (property.CanWrite ||
                    !payload.TryGetPropertyValue(property.Name, out var propertyValueNode) ||
                    propertyValueNode is null)
                {
                    continue;
                }

                if (propertyValueNode.GetValueKind() == JsonValueKind.Array ||
                    (propertyValueNode.GetValueKind() == JsonValueKind.Object &&
                    propertyValueNode.AsObject().TryGetPropertyValue("$values", out propertyValueNode) &&
                    propertyValueNode is JsonArray))
                {
                    var collection = property.GetValue(value);
                    PopulateChildrenIntoCollection(collection, (JsonArray)propertyValueNode, options);
                }
            }
        }

        return value;
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        options.Converters.Remove(this);
        JsonSerializer.Serialize(writer, value, options);
        options.Converters.Add(this);
    }
}
```

使用的时候, 假如你有一个类型 `A`, 它有一个只读的集合属性, 例如 `public List<int> SomeCollection { get; } = new();`,
那么在反序列化的时候, 在 `Converters` 列表最前方添加一个 `AutoPopulateMemberCollectionConverter<A>` 就可以了.

如果放到后面, 类型实例化可能会优先被其他转换器执行, 导致无法自动填充成员. 此转换器会自动使用后续转换器来转换, 得出值之后, 再进行填充.